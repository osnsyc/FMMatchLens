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
}

internal sealed class ArchiveFormatException : IOException
{
    public ArchiveFormatException(string code, string message) : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}
