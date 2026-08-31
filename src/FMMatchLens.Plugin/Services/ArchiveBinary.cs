using System.Text;

namespace FMMatchLens.Plugin.Services;

internal static class ArchiveBinary
{
    private const int MaxStringBytes = 1_048_576;
    private static readonly uint[] CrcTable = BuildCrcTable();
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static void WriteVarUInt64(BinaryWriter writer, ulong value)
    {
        while (value >= 0x80)
        {
            writer.Write((byte)(value | 0x80));
            value >>= 7;
        }
        writer.Write((byte)value);
    }

    public static ulong ReadVarUInt64(BinaryReader reader, int maxBytes = 10)
    {
        ulong result = 0;
        for (var index = 0; index < maxBytes; index++)
        {
            var value = reader.ReadByte();
            if (index == 9 && value > 1) throw new ArchiveFormatException("invalid_varint", "VarInt exceeds UInt64 range.");
            result |= (ulong)(value & 0x7f) << (index * 7);
            if ((value & 0x80) == 0) return result;
        }
        throw new ArchiveFormatException("invalid_varint", "VarInt is too long.");
    }

    public static void WriteVarInt64(BinaryWriter writer, long value) =>
        WriteVarUInt64(writer, unchecked((ulong)((value << 1) ^ (value >> 63))));

    public static long ReadVarInt64(BinaryReader reader)
    {
        var value = ReadVarUInt64(reader);
        return unchecked((long)(value >> 1) ^ -((long)value & 1));
    }

    public static void WriteString(BinaryWriter writer, string? value)
    {
        var bytes = StrictUtf8.GetBytes(value ?? string.Empty);
        WriteVarUInt64(writer, (ulong)bytes.Length);
        writer.Write(bytes);
    }

    public static string ReadString(BinaryReader reader)
    {
        var length = checked((int)ReadVarUInt64(reader, 5));
        if (length > MaxStringBytes) throw new ArchiveFormatException("invalid_length", "Archive string is too large.");
        var bytes = reader.ReadBytes(length);
        if (bytes.Length != length) throw new EndOfStreamException();
        try
        {
            return StrictUtf8.GetString(bytes);
        }
        catch (DecoderFallbackException ex)
        {
            throw new ArchiveFormatException("invalid_utf8", $"Archive contains invalid UTF-8: {ex.Message}");
        }
    }

    public static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        var crc = uint.MaxValue;
        foreach (var value in bytes) crc = CrcTable[(crc ^ value) & 0xff] ^ (crc >> 8);
        return ~crc;
    }

    public static void WriteLengthPrefixedRecord(BinaryWriter writer, byte recordType, ReadOnlySpan<byte> payload)
    {
        writer.Write(recordType);
        writer.Write((uint)payload.Length);
        writer.Write(Crc32(payload));
        writer.Write(payload);
    }

    public static byte[] ReadLengthPrefixedPayload(BinaryReader reader, int maxLength)
    {
        var length = reader.ReadUInt32();
        var expectedCrc = reader.ReadUInt32();
        if (length > maxLength) throw new ArchiveFormatException("invalid_length", $"Archive record length {length} exceeds its limit.");
        var payload = reader.ReadBytes(checked((int)length));
        if (payload.Length != length) throw new EndOfStreamException();
        if (Crc32(payload) != expectedCrc) throw new ArchiveFormatException("crc_mismatch", "Archive record CRC does not match.");
        return payload;
    }

    public static ushort Quantize(float value, float halfExtent)
    {
        if (!float.IsFinite(value) || !float.IsFinite(halfExtent) || halfExtent <= 0)
        {
            throw new ArchiveFormatException("invalid_coordinate", "A coordinate or pitch extent is not finite.");
        }
        var normalized = Math.Clamp((value + halfExtent) / (halfExtent * 2f), 0f, 1f);
        return (ushort)MathF.Round(normalized * ushort.MaxValue);
    }

    public static float Dequantize(ushort value, float halfExtent) =>
        value / (float)ushort.MaxValue * (halfExtent * 2f) - halfExtent;

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint index = 0; index < table.Length; index++)
        {
            var value = index;
            for (var bit = 0; bit < 8; bit++) value = (value & 1) != 0 ? 0xedb88320u ^ (value >> 1) : value >> 1;
            table[index] = value;
        }
        return table;
    }
}
