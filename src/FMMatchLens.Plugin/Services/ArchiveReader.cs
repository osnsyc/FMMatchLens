using FMMatchLens.Plugin.Domain;
using System.IO.Compression;
using System.Text;

namespace FMMatchLens.Plugin.Services;

internal sealed record ArchiveScanResult(
    MatchArchiveSummary Summary,
    RealtimeMatchMetadata? Metadata,
    IReadOnlyList<RealtimeMatchMetadata> MetadataTimeline,
    IReadOnlyList<RealtimeTickFrame> Frames);

internal static class ArchiveReader
{
    private const int MaxHeaderBytes = 64 * 1024;
    private const int MaxMetadataBytes = 4 * 1024 * 1024;
    private const int MaxIndexBytes = 4 * 1024 * 1024;

    public static bool TryScan(
        string path,
        int fromTick,
        int? toTick,
        int stride,
        int limit,
        bool materialize,
        out ArchiveScanResult result)
    {
        result = default!;
        if (!File.Exists(path)) return false;
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
            var header = ReadHeader(stream);
            var blocks = new List<BlockReference>();
            var metadataTimeline = new List<RealtimeMatchMetadata>();
            RealtimeMatchMetadata? metadata = null;
            uint metadataRevision = 0;
            FinalSummary? finalSummary = null;
            long? endedAt = null;
            var ended = false;

            while (stream.Position < stream.Length)
            {
                var recordStart = stream.Position;
                try
                {
                    var recordType = reader.ReadByte();
                    switch (recordType)
                    {
                        case ArchiveWriter.MetadataRecord:
                            var metadataPayload = ArchiveBinary.ReadLengthPrefixedPayload(reader, MaxMetadataBytes);
                            var decodedMetadata = ArchiveMetadataCodec.Decode(metadataPayload, header.MatchId, header.StartedUnixMilliseconds);
                            if (decodedMetadata.Revision <= metadataRevision) throw new ArchiveFormatException("invalid_metadata_revision", "Metadata revisions are not strictly increasing.");
                            metadataRevision = decodedMetadata.Revision;
                            metadata = decodedMetadata.Metadata;
                            metadataTimeline.Add(metadata);
                            break;
                        case ArchiveWriter.MetadataDeltaRecord:
                            var deltaPayload = ArchiveBinary.ReadLengthPrefixedPayload(reader, MaxMetadataBytes);
                            if (metadata is null) throw new ArchiveFormatException("missing_metadata_base", "Metadata delta has no full metadata base.");
                            var decodedDelta = ArchiveMetadataCodec.DecodeDelta(
                                deltaPayload,
                                metadata,
                                header.MatchId,
                                header.StartedUnixMilliseconds);
                            if (decodedDelta.Revision <= metadataRevision) throw new ArchiveFormatException("invalid_metadata_revision", "Metadata revisions are not strictly increasing.");
                            metadataRevision = decodedDelta.Revision;
                            metadata = decodedDelta.Metadata;
                            metadataTimeline.Add(metadata);
                            break;
                        case ArchiveWriter.ChunkRecord:
                            var block = ReadBlockReference(stream, reader, recordStart);
                            blocks.Add(block);
                            stream.Position = checked(block.PayloadOffset + block.CompressedLength);
                            break;
                        case ArchiveWriter.FinalIndexRecord:
                            finalSummary = ReadFinalIndex(ArchiveBinary.ReadLengthPrefixedPayload(reader, MaxIndexBytes), blocks);
                            break;
                        case ArchiveWriter.EndRecord:
                            var endPayload = ArchiveBinary.ReadLengthPrefixedPayload(reader, 64);
                            if (endPayload.Length != sizeof(long)) throw new ArchiveFormatException("invalid_end_record", "end record has an invalid length.");
                            endedAt = BitConverter.ToInt64(endPayload);
                            ended = true;
                            break;
                        default:
                            _ = ArchiveBinary.ReadLengthPrefixedPayload(reader, MaxMetadataBytes);
                            break;
                    }
                    if (ended) break;
                }
                catch (EndOfStreamException)
                {
                    stream.Position = Math.Min(recordStart, stream.Length);
                    break;
                }
                catch (ArchiveFormatException ex)
                {
                    ArchiveDiagnostics.Warning($"Stopped archive scan at byte {recordStart} ({ex.Code}): {ex.Message}");
                    break;
                }
            }

            var frames = materialize ? new List<RealtimeTickFrame>(Math.Min(limit, 2_400)) : new List<RealtimeTickFrame>(0);
            var accepted = 0;
            int? failedBlockIndex = null;
            for (var blockIndex = 0; blockIndex < blocks.Count; blockIndex++)
            {
                var block = blocks[blockIndex];
                if (!materialize || block.EndTick < fromTick || (toTick.HasValue && block.StartTick > toTick.Value)) continue;
                IReadOnlyList<RealtimeTickFrame> decoded;
                try
                {
                    decoded = DecodeBlock(stream, block, header.MatchId);
                }
                catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException or IOException)
                {
                    ArchiveDiagnostics.Warning($"Stopped archive decode at tick {block.StartTick}: {ex.Message}");
                    failedBlockIndex = blockIndex;
                    break;
                }
                foreach (var frame in decoded)
                {
                    if (frame.Tick < fromTick || (toTick.HasValue && frame.Tick > toTick.Value)) continue;
                    if (accepted++ % stride == 0 && frames.Count < limit) frames.Add(frame);
                }
                if (frames.Count >= limit) break;
            }

            var summaryBlocks = failedBlockIndex.HasValue ? blocks.Take(failedBlockIndex.Value).ToArray() : blocks.ToArray();
            if (failedBlockIndex.HasValue)
            {
                finalSummary = null;
                ended = false;
                endedAt = null;
            }
            var totalFrames = finalSummary?.FrameCount ?? summaryBlocks.Sum(block => block.FrameCount);
            var firstTick = finalSummary?.FirstTick ?? (summaryBlocks.Length == 0 ? -1 : summaryBlocks[0].StartTick);
            var lastTick = finalSummary?.LastTick ?? (summaryBlocks.Length == 0 ? -1 : summaryBlocks[^1].EndTick);
            var homeGoals = finalSummary?.HomeGoals ?? 0;
            var awayGoals = finalSummary?.AwayGoals ?? 0;
            if (finalSummary is null && summaryBlocks.Length > 0)
            {
                try
                {
                    var lastFrames = DecodeBlock(stream, summaryBlocks[^1], header.MatchId);
                    homeGoals = lastFrames[^1].Home.Goals;
                    awayGoals = lastFrames[^1].Away.Goals;
                }
                catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException or IOException)
                {
                    ArchiveDiagnostics.Warning($"Unable to decode the last archive summary block: {ex.Message}");
                }
            }

            var info = new FileInfo(path);
            var (homeName, awayName) = ResolveNames(header.MatchId, info.Name, metadata);
            result = new ArchiveScanResult(
                new MatchArchiveSummary(header.MatchId, info.Name, header.StartedUnixMilliseconds, endedAt, ended,
                    totalFrames, firstTick, lastTick, homeName, awayName, homeGoals, awayGoals, info.Length),
                metadata,
                metadataTimeline.ToArray(),
                frames);
            return true;
        }
        catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException or IOException or OverflowException)
        {
            ArchiveDiagnostics.Warning($"Unable to read match archive {Path.GetFileName(path)}: {ex.Message}");
            return false;
        }
    }

    internal static ArchiveHeader ReadHeader(Stream stream)
    {
        stream.Position = 0;
        Span<byte> fixedHeader = stackalloc byte[16];
        ReadExactly(stream, fixedHeader);
        if (!fixedHeader[..ArchiveWireFormat.Magic.Length].SequenceEqual(ArchiveWireFormat.Magic))
            throw new ArchiveFormatException("invalid_magic", "File does not contain archive magic.");
        var headerLength = BitConverter.ToUInt32(fixedHeader[12..16]);
        if (headerLength is < 36 or > MaxHeaderBytes || headerLength > stream.Length)
            throw new ArchiveFormatException("invalid_header_length", "header length is invalid.");
        var bytes = new byte[headerLength];
        fixedHeader.CopyTo(bytes);
        ReadExactly(stream, bytes.AsSpan(fixedHeader.Length));
        var expectedCrc = BitConverter.ToUInt32(bytes.AsSpan(bytes.Length - 4));
        if (ArchiveBinary.Crc32(bytes.AsSpan(0, bytes.Length - 4)) != expectedCrc)
            throw new ArchiveFormatException("header_crc_mismatch", "header CRC does not match.");
        using var headerStream = new MemoryStream(bytes, writable: false);
        using var reader = new BinaryReader(headerStream, Encoding.UTF8);
        _ = reader.ReadBytes(ArchiveWireFormat.Magic.Length);
        var major = reader.ReadUInt16();
        var minor = reader.ReadUInt16();
        _ = reader.ReadUInt32();
        if (major != ArchiveWriter.StructureMajor) throw new ArchiveFormatException("unsupported_archive_structure", $"Archive structure {major} is not supported.");
        var flags = reader.ReadUInt64();
        var matchId = ArchiveBinary.ReadString(reader);
        var started = reader.ReadInt64();
        var coordinateEncoding = reader.ReadByte();
        var chunkTicks = reader.ReadUInt16();
        var compressionValue = reader.ReadByte();
        if (headerStream.Position > bytes.Length - sizeof(uint)) throw new ArchiveFormatException("invalid_header_length", "header fields overlap its CRC.");
        if (coordinateEncoding != 1) throw new ArchiveFormatException("unsupported_coordinate_encoding", $"Coordinate encoding {coordinateEncoding} is not supported.");
        if (compressionValue > (byte)ArchiveCompression.Deflate) throw new ArchiveFormatException("unsupported_compression", $"Compression {compressionValue} is not supported.");
        stream.Position = headerLength;
        return new ArchiveHeader(major, minor, flags, matchId, started, coordinateEncoding, chunkTicks, (ArchiveCompression)compressionValue, headerLength);
    }

    private static BlockReference ReadBlockReference(Stream stream, BinaryReader reader, long recordStart)
    {
        var remainingHeader = reader.ReadBytes(29);
        if (remainingHeader.Length != 29) throw new EndOfStreamException();
        var expectedHeaderCrc = reader.ReadUInt32();
        var headerBytes = new byte[30];
        headerBytes[0] = ArchiveWriter.ChunkRecord;
        remainingHeader.CopyTo(headerBytes, 1);
        if (ArchiveBinary.Crc32(headerBytes) != expectedHeaderCrc) throw new ArchiveFormatException("block_header_crc_mismatch", "Archive block header CRC does not match.");
        using var headerStream = new MemoryStream(remainingHeader, writable: false);
        using var headerReader = new BinaryReader(headerStream, Encoding.UTF8);
        if (headerReader.ReadUInt32() != ArchiveWriter.BlockMagic) throw new ArchiveFormatException("invalid_block_magic", "Archive block magic is invalid.");
        if (headerReader.ReadByte() != ArchiveWriter.BlockStructure) throw new ArchiveFormatException("unsupported_block_structure", "Archive block structure is not supported.");
        var compressionValue = headerReader.ReadUInt16();
        if (compressionValue > (ushort)ArchiveCompression.Deflate) throw new ArchiveFormatException("unsupported_compression", $"Block compression {compressionValue} is not supported.");
        var startTick = headerReader.ReadInt32();
        var endTick = headerReader.ReadInt32();
        var frameCount = headerReader.ReadUInt16();
        var rawLength = checked((int)headerReader.ReadUInt32());
        var compressedLength = checked((int)headerReader.ReadUInt32());
        var payloadCrc = headerReader.ReadUInt32();
        if (frameCount == 0 || endTick < startTick) throw new ArchiveFormatException("invalid_block_range", "Archive block tick range is invalid.");
        if (rawLength is <= 0 or > ArchiveWriter.MaxUncompressedChunkBytes || compressedLength is <= 0 or > ArchiveWriter.MaxCompressedChunkBytes)
            throw new ArchiveFormatException("invalid_block_length", "Archive block length is invalid.");
        var payloadOffset = stream.Position;
        if (payloadOffset + compressedLength > stream.Length) throw new EndOfStreamException();
        return new BlockReference(recordStart, startTick, endTick, frameCount, rawLength, compressedLength, payloadCrc, (ArchiveCompression)compressionValue, payloadOffset);
    }

    private static IReadOnlyList<RealtimeTickFrame> DecodeBlock(Stream stream, BlockReference block, string matchId)
    {
        stream.Position = block.PayloadOffset;
        var compressed = new byte[block.CompressedLength];
        ReadExactly(stream, compressed);
        byte[] raw;
        if (block.Compression == ArchiveCompression.None)
        {
            raw = compressed;
        }
        else if (block.Compression == ArchiveCompression.Deflate)
        {
            using var input = new MemoryStream(compressed, writable: false);
            using var deflate = new ZLibStream(input, CompressionMode.Decompress);
            using var output = new MemoryStream(block.UncompressedLength);
            var buffer = new byte[64 * 1024];
            while (true)
            {
                var read = deflate.Read(buffer, 0, buffer.Length);
                if (read == 0) break;
                if (output.Length + read > block.UncompressedLength)
                    throw new ArchiveFormatException("decompression_limit", "Archive block expands beyond its declared length.");
                output.Write(buffer, 0, read);
            }
            raw = output.ToArray();
        }
        else
        {
            throw new ArchiveFormatException("unsupported_compression", $"Block compression {block.Compression} is not supported.");
        }
        if (raw.Length != block.UncompressedLength) throw new ArchiveFormatException("decompressed_length_mismatch", "Archive block decompressed length does not match its header.");
        if (ArchiveBinary.Crc32(raw) != block.PayloadCrc) throw new ArchiveFormatException("payload_crc_mismatch", "Archive block payload CRC does not match.");
        var frames = ArchiveFrameCodec.Decode(raw, matchId, block.FrameCount);
        if (frames[0].Tick != block.StartTick || frames[^1].Tick != block.EndTick) throw new ArchiveFormatException("block_range_mismatch", "Decoded block range does not match its header.");
        return frames;
    }

    private static FinalSummary ReadFinalIndex(byte[] payload, IReadOnlyList<BlockReference> scannedBlocks)
    {
        using var stream = new MemoryStream(payload, writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var frameCount = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        var firstTick = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var lastTick = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var homeGoals = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var awayGoals = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var count = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (count > 65_536 || count != scannedBlocks.Count) throw new ArchiveFormatException("invalid_index", "final index block count is invalid.");
        for (var index = 0; index < count; index++)
        {
            var startTick = checked((int)ArchiveBinary.ReadVarInt64(reader));
            var endTick = checked((int)ArchiveBinary.ReadVarInt64(reader));
            var offset = checked((long)ArchiveBinary.ReadVarUInt64(reader));
            var compressedLength = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
            var blockFrames = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
            var scanned = scannedBlocks[index];
            if (startTick != scanned.StartTick || endTick != scanned.EndTick || offset != scanned.RecordOffset || compressedLength != scanned.CompressedLength || blockFrames != scanned.FrameCount)
                throw new ArchiveFormatException("invalid_index", "final index does not match scanned block headers.");
        }
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "final index contains trailing data.");
        return new FinalSummary(frameCount, firstTick, lastTick, homeGoals, awayGoals);
    }

    private static (string? Home, string? Away) ResolveNames(string matchId, string fileName, RealtimeMatchMetadata? metadata)
    {
        if (!string.IsNullOrWhiteSpace(metadata?.Home.Name) && !string.IsNullOrWhiteSpace(metadata.Away.Name)) return (metadata.Home.Name, metadata.Away.Name);
        var prefix = $"{matchId}-";
        const string suffix = ".fmlens";
        if (!fileName.StartsWith(prefix, StringComparison.Ordinal) || !fileName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return (null, null);
        var matchup = fileName[prefix.Length..^suffix.Length];
        var separator = matchup.IndexOf("-vs-", StringComparison.Ordinal);
        return separator <= 0 || separator >= matchup.Length - 4 ? (null, null) : (matchup[..separator], matchup[(separator + 4)..]);
    }

    private static void ReadExactly(Stream stream, Span<byte> destination)
    {
        var offset = 0;
        while (offset < destination.Length)
        {
            var read = stream.Read(destination[offset..]);
            if (read == 0) throw new EndOfStreamException();
            offset += read;
        }
    }

    private sealed record BlockReference(
        long RecordOffset,
        int StartTick,
        int EndTick,
        int FrameCount,
        int UncompressedLength,
        int CompressedLength,
        uint PayloadCrc,
        ArchiveCompression Compression,
        long PayloadOffset);

    private sealed record FinalSummary(int FrameCount, int FirstTick, int LastTick, int HomeGoals, int AwayGoals);
}
