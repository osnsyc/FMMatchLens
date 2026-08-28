using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

internal static class VirtualMemory
{
    private const uint MemCommit = 0x1000;
    private const uint PageNoAccess = 0x01;
    private const uint PageGuard = 0x100;

    [DllImport("kernel32.dll")]
    private static extern nuint VirtualQuery(nint lpAddress, out MemoryBasicInformation lpBuffer, nuint dwLength);

    public static bool IsReadable(nint address, int size)
    {
        if (address == default || size <= 0)
        {
            return false;
        }

        if (VirtualQuery(address, out var info, (nuint)Marshal.SizeOf<MemoryBasicInformation>()) == 0)
        {
            return false;
        }

        if (info.State != MemCommit)
        {
            return false;
        }

        if ((info.Protect & PageNoAccess) != 0 || (info.Protect & PageGuard) != 0)
        {
            return false;
        }

        var start = (ulong)address;
        var end = start + (uint)size;
        var regionStart = (ulong)info.BaseAddress;
        var regionEnd = regionStart + (ulong)info.RegionSize;

        return start >= regionStart && end <= regionEnd;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryBasicInformation
    {
        public nint BaseAddress;
        public nint AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public nuint RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }
}

