using System.Text;

namespace FMMatchLens.Plugin.Services;

internal enum ArchiveCompression : byte
{
    None = 0,
    Deflate = 1
}

internal sealed record ArchiveWriteOptions(
    ArchiveCompression Compression,
    int ChunkTicks,
    int MaxChunkLatencyMilliseconds,
    int QueueCapacity)
{
    public static ArchiveWriteOptions Default { get; } = new(
        ArchiveCompression.Deflate,
        128,
        1_000,
        8);
}

internal static class ArchiveWireFormat
{
    internal static readonly byte[] Magic = Encoding.ASCII.GetBytes("FMLENS2\0");

    // The chunked archive format introduced by commit b28a3d2 is 2.1.
    // Momentum-event sequence/completion fields and trajectories define 2.2.
    // Team-manager metadata defines 2.3. Player birth date, nation UID, body
    // type, and guide value define 2.4. Pitch dimensions in metadata define 2.5.
    // Goalkeeper save breakdown fields and competition metadata define 2.6.
    // The file-header version is the sole authority for payload decoding; do not
    // add an independent version byte inside ArchiveFrameCodec payloads.
    internal const ushort StructureMajor = 2;
    internal const ushort FirstSupportedStructureMinor = 1;
    internal const ushort StructureMinor = 6;
    internal const byte Legacy21BlockStructure = 1;
    internal const byte Legacy21FramePayloadMarker = 1;
}

internal sealed class ArchiveFormatException : IOException
{
    public ArchiveFormatException(string code, string message) : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}
