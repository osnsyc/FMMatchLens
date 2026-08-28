namespace FMMatchLens.Plugin.Memory;

internal sealed class MemoryReader
{
    public bool TryReadByte(nint address, out byte value)
    {
        value = default;

        if (!VirtualMemory.IsReadable(address, sizeof(byte)))
        {
            return false;
        }

        value = System.Runtime.InteropServices.Marshal.ReadByte(address);
        return true;
    }

    public bool TryReadInt16(nint address, out short value)
    {
        value = default;

        if (!VirtualMemory.IsReadable(address, sizeof(short)))
        {
            return false;
        }

        value = System.Runtime.InteropServices.Marshal.ReadInt16(address);
        return true;
    }

    public bool TryReadInt32(nint address, out int value)
    {
        value = default;

        if (!VirtualMemory.IsReadable(address, sizeof(int)))
        {
            return false;
        }

        value = System.Runtime.InteropServices.Marshal.ReadInt32(address);
        return true;
    }

    public bool TryReadUInt32(nint address, out uint value)
    {
        value = default;

        if (!TryReadInt32(address, out var signedValue))
        {
            return false;
        }

        value = unchecked((uint)signedValue);
        return true;
    }

    public bool TryReadUInt64(nint address, out ulong value)
    {
        value = default;

        if (!VirtualMemory.IsReadable(address, sizeof(ulong)))
        {
            return false;
        }

        value = unchecked((ulong)System.Runtime.InteropServices.Marshal.ReadInt64(address));
        return true;
    }

    public bool TryReadFloat(nint address, out float value)
    {
        value = default;

        if (!TryReadInt32(address, out var raw))
        {
            return false;
        }

        value = BitConverter.Int32BitsToSingle(raw);
        return true;
    }

    public bool TryReadPointer(nint address, out nint value)
    {
        value = default;

        if (!VirtualMemory.IsReadable(address, IntPtr.Size))
        {
            return false;
        }

        value = System.Runtime.InteropServices.Marshal.ReadIntPtr(address);
        return true;
    }

    public bool TryReadHexPointer(string text, out nint value)
    {
        value = default;

        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var normalized = text.Trim();
        if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized[2..];
        }

        if (!long.TryParse(normalized, System.Globalization.NumberStyles.HexNumber, null, out var parsed))
        {
            return false;
        }

        value = (nint)parsed;
        return value != default;
    }
}
