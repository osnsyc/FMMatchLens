using FMMatchLens.Plugin.Domain;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;

namespace FMMatchLens.Plugin.Services;

internal sealed record ArchiveHeader(
    ushort StructureMajor,
    ushort StructureMinor,
    ulong FeatureFlags,
    string MatchId,
    long StartedUnixMilliseconds,
    byte CoordinateEncoding,
    ushort DefaultChunkTicks,
    ArchiveCompression Compression,
    uint HeaderLength);

internal sealed record ArchiveBlockIndexEntry(
    int StartTick,
    int EndTick,
    long FileOffset,
    int CompressedLength,
    int FrameCount);

internal sealed class ArchiveWriter : IDisposable
{
    internal const ushort StructureMajor = 2;
    internal const ushort StructureMinor = 1;
    internal const byte MetadataRecord = 1;
    internal const byte ChunkRecord = 2;
    internal const byte FinalIndexRecord = 3;
    internal const byte EndRecord = 4;
    internal const byte MetadataDeltaRecord = 5;
    internal const uint BlockMagic = 0x324b4c42;
    internal const byte BlockStructure = 1;
    internal const int MaxUncompressedChunkBytes = 16 * 1024 * 1024;
    internal const int MaxCompressedChunkBytes = 16 * 1024 * 1024;

    private const ulong QuantizedCoordinatesFlag = 1UL << 0;
    private const ulong CapturedTimeDeltasFlag = 1UL << 1;
    private const ulong StatisticDeltasFlag = 1UL << 2;
    private const ulong FinalIndexFlag = 1UL << 3;
    private const ulong EventEndpointsFlag = 1UL << 4;
    private const ulong DeflateFlag = 1UL << 5;
    private readonly object _gate = new();
    private readonly string _path;
    private readonly string _matchId;
    private readonly ArchiveWriteOptions _options;
    private readonly BlockingCollection<WorkItem> _queue;
    private readonly Task _worker;
    private readonly Timer _sealTimer;
    private readonly List<RealtimeTickFrame> _pendingFrames;
    private long _lastSealTimestamp;
    private uint _metadataRevision;
    private RealtimeMatchMetadata? _metadataSnapshot;
    private int _maxQueueDepth;
    private bool _accepting = true;
    private bool _completed;
    private bool _disposed;
    private volatile Exception? _failure;

    public ArchiveWriter(string path, string matchId, long startedUnixMilliseconds, ArchiveWriteOptions options)
    {
        _path = path;
        _matchId = matchId;
        _options = options with
        {
            ChunkTicks = Math.Clamp(options.ChunkTicks, 1, 4_096),
            MaxChunkLatencyMilliseconds = Math.Clamp(options.MaxChunkLatencyMilliseconds, 100, 60_000),
            QueueCapacity = Math.Clamp(options.QueueCapacity, 1, 64)
        };
        _pendingFrames = new List<RealtimeTickFrame>(_options.ChunkTicks);
        _queue = new BlockingCollection<WorkItem>(_options.QueueCapacity);

        using (var stream = OpenOutput(path))
        {
            var header = EncodeHeader(matchId, startedUnixMilliseconds, _options);
            stream.Write(header);
            stream.Flush(flushToDisk: true);
        }
        _lastSealTimestamp = Environment.TickCount64;
        _worker = Task.Factory.StartNew(ProcessQueue, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        _sealTimer = new Timer(_ => SealExpiredChunk(), null, _options.MaxChunkLatencyMilliseconds, _options.MaxChunkLatencyMilliseconds);
        WriteInitialMetadata(new RealtimeMatchMetadata(
            matchId,
            startedUnixMilliseconds,
            -1,
            new RealtimeTeamMetadata(null, null, "Home", null, null, null, null),
            new RealtimeTeamMetadata(null, null, "Away", null, null, null, null),
            Array.Empty<RealtimePlayerMetadata>()));
    }

    public bool HasFailed => _failure is not null;

    public void Append(RealtimeTickFrame frame)
    {
        lock (_gate)
        {
            if (!_accepting || _failure is not null || frame.MatchId != _matchId) return;
            _pendingFrames.Add(frame);
            var now = Environment.TickCount64;
            if (_pendingFrames.Count >= _options.ChunkTicks || now - _lastSealTimestamp >= _options.MaxChunkLatencyMilliseconds)
            {
                SealChunkLocked(now);
            }
        }
    }

    public void WriteMetadata(RealtimeMatchMetadata metadata)
    {
        lock (_gate)
        {
            if (!_accepting || _failure is not null || metadata.MatchId != _matchId) return;
            if (_metadataSnapshot is null)
            {
                var payload = ArchiveMetadataCodec.Encode(metadata, ++_metadataRevision);
                if (ArchiveMetadataCodec.HasCompleteStaticPlayerSnapshot(metadata)) _metadataSnapshot = metadata;
                EnqueueLocked(new MetadataWorkItem(MetadataRecord, payload));
                return;
            }

            var revision = checked(_metadataRevision + 1);
            if (!ArchiveMetadataCodec.TryEncodeDelta(_metadataSnapshot, metadata, revision, out var delta)) return;
            _metadataRevision = revision;
            _metadataSnapshot = delta.Metadata;
            EnqueueLocked(new MetadataWorkItem(MetadataDeltaRecord, delta.Payload));
        }
    }

    private void WriteInitialMetadata(RealtimeMatchMetadata metadata)
    {
        lock (_gate)
        {
            var payload = ArchiveMetadataCodec.Encode(metadata, ++_metadataRevision);
            EnqueueLocked(new MetadataWorkItem(MetadataRecord, payload));
        }
    }

    public void Complete(long endedUnixMilliseconds)
    {
        lock (_gate)
        {
            if (_completed) return;
            _sealTimer.Change(Timeout.Infinite, Timeout.Infinite);
            if (_accepting)
            {
                SealChunkLocked(Environment.TickCount64);
                EnqueueLocked(new CompleteWorkItem(endedUnixMilliseconds));
                _accepting = false;
            }
            if (!_queue.IsAddingCompleted) _queue.CompleteAdding();
        }
        WaitForWorker(TimeSpan.FromSeconds(15));
        _completed = _failure is null;
        if (_failure is not null) throw new IOException("Archive writer failed.", _failure);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _sealTimer.Change(Timeout.Infinite, Timeout.Infinite);
            if (_accepting)
            {
                SealChunkLocked(Environment.TickCount64);
                _accepting = false;
                if (!_queue.IsAddingCompleted) _queue.CompleteAdding();
            }
        }
        WaitForWorker(TimeSpan.FromSeconds(_completed ? 15 : 3));
        _sealTimer.Dispose();
        _queue.Dispose();
    }

    private void SealChunkLocked(long now)
    {
        if (_pendingFrames.Count == 0) return;
        var frames = _pendingFrames.ToArray();
        _pendingFrames.Clear();
        _lastSealTimestamp = now;
        EnqueueLocked(new ChunkWorkItem(frames));
    }

    private void SealExpiredChunk()
    {
        lock (_gate)
        {
            if (!_accepting || _pendingFrames.Count == 0) return;
            var now = Environment.TickCount64;
            if (now - _lastSealTimestamp >= _options.MaxChunkLatencyMilliseconds) SealChunkLocked(now);
        }
    }

    private void EnqueueLocked(WorkItem item)
    {
        if (_failure is not null) return;
        if (_queue.TryAdd(item, millisecondsTimeout: 100))
        {
            var depth = _queue.Count;
            while (true)
            {
                var observed = Volatile.Read(ref _maxQueueDepth);
                if (depth <= observed || Interlocked.CompareExchange(ref _maxQueueDepth, depth, observed) == observed) break;
            }
            return;
        }
        _failure = new IOException("The bounded archive writer queue is full.");
        _accepting = false;
        _queue.CompleteAdding();
        ArchiveDiagnostics.Warning("Archive writing stopped because its bounded queue remained full.");
    }

    private void ProcessQueue()
    {
        var index = new List<ArchiveBlockIndexEntry>();
        var totalFrames = 0;
        var firstTick = -1;
        var lastTick = -1;
        var homeGoals = 0;
        var awayGoals = 0;
        var encodeTimes = new List<double>();
        var compressionTimes = new List<double>();
        try
        {
            using var stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
            using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
            foreach (var item in _queue.GetConsumingEnumerable())
            {
                switch (item)
                {
                    case MetadataWorkItem metadata:
                        ArchiveBinary.WriteLengthPrefixedRecord(writer, metadata.RecordType, metadata.Payload);
                        writer.Flush();
                        break;
                    case ChunkWorkItem chunk:
                        var stopwatch = Stopwatch.StartNew();
                        var raw = ArchiveFrameCodec.Encode(chunk.Frames);
                        var encodeMilliseconds = stopwatch.Elapsed.TotalMilliseconds;
                        stopwatch.Restart();
                        var compressed = Compress(raw, _options.Compression);
                        var compressionMilliseconds = stopwatch.Elapsed.TotalMilliseconds;
                        encodeTimes.Add(encodeMilliseconds);
                        compressionTimes.Add(compressionMilliseconds);
                        var offset = stream.Position;
                        WriteChunk(writer, chunk.Frames, raw, compressed, _options.Compression);
                        writer.Flush();
                        var first = chunk.Frames[0];
                        var last = chunk.Frames[^1];
                        index.Add(new ArchiveBlockIndexEntry(first.Tick, last.Tick, offset, compressed.Length, chunk.Frames.Length));
                        totalFrames += chunk.Frames.Length;
                        firstTick = firstTick < 0 ? first.Tick : firstTick;
                        lastTick = last.Tick;
                        homeGoals = last.Home.Goals;
                        awayGoals = last.Away.Goals;
                        ArchiveDiagnostics.Debug($"Archive chunk {first.Tick}-{last.Tick}: {raw.Length} -> {compressed.Length} bytes, encode {encodeMilliseconds:F1} ms, compress {compressionMilliseconds:F1} ms, queue {_queue.Count}.");
                        break;
                    case CompleteWorkItem complete:
                        var finalIndex = EncodeFinalIndex(index, totalFrames, firstTick, lastTick, homeGoals, awayGoals);
                        ArchiveBinary.WriteLengthPrefixedRecord(writer, FinalIndexRecord, finalIndex);
                        using (var endStream = new MemoryStream())
                        using (var endWriter = new BinaryWriter(endStream, Encoding.UTF8, leaveOpen: true))
                        {
                            endWriter.Write(complete.EndedUnixMilliseconds);
                            ArchiveBinary.WriteLengthPrefixedRecord(writer, EndRecord, endStream.ToArray());
                        }
                        writer.Flush();
                        stream.Flush(flushToDisk: true);
                        ArchiveDiagnostics.Debug(
                            $"Archive completed: {totalFrames} frames, {index.Count} chunks, " +
                            $"encode avg/P95/max {Average(encodeTimes):F1}/{Percentile95(encodeTimes):F1}/{Maximum(encodeTimes):F1} ms, " +
                            $"compress avg/P95/max {Average(compressionTimes):F1}/{Percentile95(compressionTimes):F1}/{Maximum(compressionTimes):F1} ms, " +
                            $"max queue depth {Volatile.Read(ref _maxQueueDepth)}.");
                        break;
                }
            }
        }
        catch (Exception ex)
        {
            _failure = ex;
            ArchiveDiagnostics.Warning($"Archive writer failed for {Path.GetFileName(_path)}: {ex.Message}");
        }
    }

    private void WaitForWorker(TimeSpan timeout)
    {
        try
        {
            if (!_worker.Wait(timeout))
            {
                _failure ??= new TimeoutException($"Timed out waiting for archive writer {Path.GetFileName(_path)}.");
                ArchiveDiagnostics.Warning(_failure.Message);
            }
        }
        catch (AggregateException ex)
        {
            _failure ??= ex.InnerException ?? ex;
        }
    }

    internal static byte[] EncodeHeader(string matchId, long startedUnixMilliseconds, ArchiveWriteOptions options)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        writer.Write(ArchiveWireFormat.Magic);
        writer.Write(StructureMajor);
        writer.Write(StructureMinor);
        writer.Write(0u);
        var flags = QuantizedCoordinatesFlag | CapturedTimeDeltasFlag | StatisticDeltasFlag | FinalIndexFlag | EventEndpointsFlag;
        if (options.Compression == ArchiveCompression.Deflate) flags |= DeflateFlag;
        writer.Write(flags);
        ArchiveBinary.WriteString(writer, matchId);
        writer.Write(startedUnixMilliseconds);
        writer.Write((byte)1);
        writer.Write(checked((ushort)Math.Clamp(options.ChunkTicks, 1, ushort.MaxValue)));
        writer.Write((byte)options.Compression);
        writer.Write(0u);
        var bytes = stream.ToArray();
        BitConverter.TryWriteBytes(bytes.AsSpan(12, 4), checked((uint)bytes.Length));
        BitConverter.TryWriteBytes(bytes.AsSpan(bytes.Length - 4), ArchiveBinary.Crc32(bytes.AsSpan(0, bytes.Length - 4)));
        return bytes;
    }

    private static FileStream OpenOutput(string path) =>
        new(path, FileMode.Create, FileAccess.Write, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);

    private static byte[] Compress(byte[] raw, ArchiveCompression compression)
    {
        if (compression == ArchiveCompression.None) return raw;
        if (compression != ArchiveCompression.Deflate) throw new ArchiveFormatException("unsupported_compression", $"Compression {compression} is not supported.");
        using var output = new MemoryStream();
        using (var deflate = new ZLibStream(output, CompressionLevel.Fastest, leaveOpen: true)) deflate.Write(raw);
        return output.ToArray();
    }

    private static void WriteChunk(BinaryWriter writer, IReadOnlyList<RealtimeTickFrame> frames, byte[] raw, byte[] compressed, ArchiveCompression compression)
    {
        using var headerStream = new MemoryStream();
        using (var headerWriter = new BinaryWriter(headerStream, Encoding.UTF8, leaveOpen: true))
        {
            headerWriter.Write(ChunkRecord);
            headerWriter.Write(BlockMagic);
            headerWriter.Write(BlockStructure);
            headerWriter.Write((ushort)compression);
            headerWriter.Write(frames[0].Tick);
            headerWriter.Write(frames[^1].Tick);
            headerWriter.Write(checked((ushort)frames.Count));
            headerWriter.Write(checked((uint)raw.Length));
            headerWriter.Write(checked((uint)compressed.Length));
            headerWriter.Write(ArchiveBinary.Crc32(raw));
        }
        var header = headerStream.ToArray();
        writer.Write(header);
        writer.Write(ArchiveBinary.Crc32(header));
        writer.Write(compressed);
    }

    private static byte[] EncodeFinalIndex(
        IReadOnlyList<ArchiveBlockIndexEntry> entries,
        int totalFrames,
        int firstTick,
        int lastTick,
        int homeGoals,
        int awayGoals)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)totalFrames);
        ArchiveBinary.WriteVarInt64(writer, firstTick);
        ArchiveBinary.WriteVarInt64(writer, lastTick);
        ArchiveBinary.WriteVarInt64(writer, homeGoals);
        ArchiveBinary.WriteVarInt64(writer, awayGoals);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)entries.Count);
        foreach (var entry in entries)
        {
            ArchiveBinary.WriteVarInt64(writer, entry.StartTick);
            ArchiveBinary.WriteVarInt64(writer, entry.EndTick);
            ArchiveBinary.WriteVarUInt64(writer, checked((ulong)entry.FileOffset));
            ArchiveBinary.WriteVarUInt64(writer, checked((ulong)entry.CompressedLength));
            ArchiveBinary.WriteVarUInt64(writer, checked((ulong)entry.FrameCount));
        }
        return stream.ToArray();
    }

    private static double Average(IReadOnlyList<double> values) => values.Count == 0 ? 0 : values.Average();

    private static double Maximum(IReadOnlyList<double> values) => values.Count == 0 ? 0 : values.Max();

    private static double Percentile95(IReadOnlyList<double> values)
    {
        if (values.Count == 0) return 0;
        var ordered = values.OrderBy(value => value).ToArray();
        return ordered[(int)Math.Ceiling(ordered.Length * 0.95) - 1];
    }

    private abstract record WorkItem;
    private sealed record MetadataWorkItem(byte RecordType, byte[] Payload) : WorkItem;
    private sealed record ChunkWorkItem(RealtimeTickFrame[] Frames) : WorkItem;
    private sealed record CompleteWorkItem(long EndedUnixMilliseconds) : WorkItem;
}
