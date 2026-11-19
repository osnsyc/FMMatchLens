using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// macOS replacements for the kernel32 calls the capture layer uses on Windows:
/// module lookup (dyld instead of GetModuleHandle/GetModuleFileName), region
/// queries (mach_vm_region instead of VirtualQuery), executable ranges (Mach-O
/// load commands instead of PE section headers) and function-entry checks
/// (LC_FUNCTION_STARTS instead of RtlLookupFunctionEntry).
///
/// An "RVA" on macOS is an offset from the image's mach_header, which is where
/// dyld maps the start of __TEXT. That matches how Windows RVAs are measured
/// from the module base, so the rest of the plugin can treat both the same way.
/// </summary>
internal static class MacNative
{
    private const string LibSystem = "/usr/lib/libSystem.dylib";

    private const uint MhMagic64 = 0xFEEDFACF;
    private const uint LcSegment64 = 0x19;
    private const uint LcFunctionStarts = 0x26;
    private const uint SAttrPureInstructions = 0x80000000;
    private const uint SAttrSomeInstructions = 0x00000400;
    private const int VmProtRead = 0x1;
    private const int VmProtExecute = 0x4;
    private const int VmRegionBasicInfo64Flavor = 9;
    private const int KernSuccess = 0;

    private static readonly object FunctionStartsLock = new();
    private static nint _functionStartsModule;
    private static int[]? _functionStarts;
    private static uint? _taskSelf;

    public static bool IsMacOS => OperatingSystem.IsMacOS();

    /// <summary>One loaded image whose path contains the search text.</summary>
    internal readonly record struct LoadedImage(nint Header, string Path);

    /// <summary>
    /// Every loaded image whose path contains <paramref name="nameFragment"/>
    /// (case-insensitive). The capture layer logs all of them, because the
    /// exact name of FM's native match library on macOS is not yet confirmed.
    /// </summary>
    public static List<LoadedImage> FindImages(string nameFragment)
    {
        var result = new List<LoadedImage>();
        var count = _dyld_image_count();
        for (uint i = 0; i < count; i++)
        {
            var namePointer = _dyld_get_image_name(i);
            if (namePointer == default) continue;
            var path = Marshal.PtrToStringUTF8(namePointer);
            if (string.IsNullOrEmpty(path)) continue;
            if (path.IndexOf(nameFragment, StringComparison.OrdinalIgnoreCase) < 0) continue;
            var header = _dyld_get_image_header(i);
            if (header != default) result.Add(new LoadedImage(header, path));
        }

        return result;
    }

    /// <summary>
    /// The game's native match library. Prefers an image inside the app bundle
    /// over any other match, and a file named exactly game_plugin over a longer name.
    /// </summary>
    public static nint FindGamePlugin(out string path, out List<LoadedImage> candidates)
    {
        candidates = FindImages("game_plugin");
        path = string.Empty;
        if (candidates.Count == 0) return default;

        var best = candidates
            .OrderByDescending(image => System.IO.Path.GetFileNameWithoutExtension(image.Path)
                .Equals("game_plugin", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(image => image.Path.Contains(".app/", StringComparison.OrdinalIgnoreCase))
            .First();
        path = best.Path;
        return best.Header;
    }

    /// <summary>Path of the loaded image whose mach_header is at <paramref name="header"/>.</summary>
    public static string GetImagePath(nint header)
    {
        var count = _dyld_image_count();
        for (uint i = 0; i < count; i++)
        {
            if (_dyld_get_image_header(i) != header) continue;
            var namePointer = _dyld_get_image_name(i);
            var path = namePointer == default ? null : Marshal.PtrToStringUTF8(namePointer);
            if (!string.IsNullOrEmpty(path)) return path;
        }

        throw new InvalidOperationException($"No loaded image has its header at 0x{(ulong)header:X}.");
    }

    /// <summary>
    /// The region that contains <paramref name="address"/>. mach_vm_region
    /// returns the first region at or above the address, so a region that
    /// starts above it means the address itself is unmapped.
    /// </summary>
    public static bool TryQueryRegion(nint address, out ulong start, out ulong end, out bool readable)
    {
        start = 0;
        end = 0;
        readable = false;
        var regionAddress = (ulong)address;
        ulong regionSize = 0;
        var infoCount = (uint)(Marshal.SizeOf<VmRegionBasicInfo64>() / sizeof(int));
        var result = mach_vm_region(
            TaskSelf(), ref regionAddress, ref regionSize, VmRegionBasicInfo64Flavor,
            out var info, ref infoCount, out _);
        if (result != KernSuccess) return false;

        start = regionAddress;
        end = regionAddress + regionSize;
        if (end < start || (ulong)address < start || (ulong)address >= end) return false;
        readable = (info.Protection & VmProtRead) != 0;
        return true;
    }

    /// <summary>
    /// Executable ranges of the mapped image, as (RVA, size) pairs, read from
    /// its in-memory Mach-O load commands: sections that hold instructions,
    /// inside segments mapped executable.
    /// </summary>
    public static bool TryGetExecutableRanges(nint header, out List<(int Rva, int Size)> ranges, out string failure)
    {
        ranges = [];
        if (!TryReadHeader(header, out var commands, out var commandCount, out failure)) return false;

        ulong? textVmAddress = null;
        var segments = new List<(ulong VmAddress, int InitProt, nint FirstSection, uint SectionCount)>();
        var cursor = commands;
        for (var i = 0; i < commandCount; i++)
        {
            var command = (uint)Marshal.ReadInt32(cursor);
            var size = (uint)Marshal.ReadInt32(cursor, 4);
            if (size < 8)
            {
                failure = $"load command {i} has an invalid size {size}";
                return false;
            }

            if (command == LcSegment64)
            {
                var name = ReadFixedString(cursor + 8, 16);
                var vmAddress = (ulong)Marshal.ReadInt64(cursor, 24);
                var initProt = Marshal.ReadInt32(cursor, 60);
                var sectionCount = (uint)Marshal.ReadInt32(cursor, 64);
                if (name == "__TEXT") textVmAddress = vmAddress;
                segments.Add((vmAddress, initProt, cursor + 72, sectionCount));
            }

            cursor += (int)size;
        }

        if (textVmAddress is not { } textBase)
        {
            failure = "image has no __TEXT segment";
            return false;
        }

        foreach (var segment in segments)
        {
            if ((segment.InitProt & VmProtExecute) == 0) continue;
            for (var s = 0; s < segment.SectionCount; s++)
            {
                var section = segment.FirstSection + s * 80;
                var address = (ulong)Marshal.ReadInt64(section, 32);
                var size = (ulong)Marshal.ReadInt64(section, 40);
                var flags = (uint)Marshal.ReadInt32(section, 64);
                if ((flags & (SAttrPureInstructions | SAttrSomeInstructions)) == 0 || size == 0) continue;
                var rva = address - textBase;
                if (rva > int.MaxValue || size > int.MaxValue || rva + size > int.MaxValue)
                {
                    failure = $"section {ReadFixedString(section, 16)} lies outside the supported RVA range";
                    return false;
                }

                ranges.Add(((int)rva, (int)size));
            }
        }

        failure = ranges.Count == 0 ? "image has no executable instruction sections" : string.Empty;
        return ranges.Count > 0;
    }

    /// <summary>
    /// Adds the mapped segments of a loaded image to <paramref name="spans"/> as absolute
    /// [start, end) address ranges (__PAGEZERO excluded), so callers can tell pointers into
    /// code and constant data apart from heap pointers.
    /// </summary>
    public static bool TryGetSegmentSpans(nint header, List<(ulong Start, ulong End)> spans)
    {
        if (!TryReadHeader(header, out var commands, out var commandCount, out _)) return false;

        ulong? textVmAddress = null;
        var segments = new List<(ulong VmAddress, ulong VmSize)>();
        var cursor = commands;
        for (var i = 0; i < commandCount; i++)
        {
            var command = (uint)Marshal.ReadInt32(cursor);
            var size = (uint)Marshal.ReadInt32(cursor, 4);
            if (size < 8) return false;
            if (command == LcSegment64)
            {
                var name = ReadFixedString(cursor + 8, 16);
                var vmAddress = (ulong)Marshal.ReadInt64(cursor, 24);
                var vmSize = (ulong)Marshal.ReadInt64(cursor, 32);
                if (name == "__TEXT") textVmAddress = vmAddress;
                if (name != "__PAGEZERO" && vmSize > 0) segments.Add((vmAddress, vmSize));
            }

            cursor += (int)size;
        }

        if (textVmAddress is not { } textBase) return false;
        var slide = (ulong)header - textBase;
        foreach (var (vmAddress, vmSize) in segments) spans.Add((vmAddress + slide, vmAddress + slide + vmSize));
        return true;
    }

    /// <summary>
    /// True when <paramref name="rva"/> is listed in the image's LC_FUNCTION_STARTS
    /// table. Detouring an address inside a function corrupts it, so this plays the
    /// role the unwind-table check plays on Windows.
    /// </summary>
    public static bool IsFunctionEntry(nint header, int rva)
    {
        var starts = GetFunctionStarts(header);
        return starts is not null && Array.BinarySearch(starts, rva) >= 0;
    }

    /// <summary>Number of functions listed in LC_FUNCTION_STARTS, or -1 if the table is missing.</summary>
    public static int CountFunctionStarts(nint header) => GetFunctionStarts(header)?.Length ?? -1;

    /// <summary>CPU type from the mach_header (0x0100000C is arm64, 0x01000007 is x86_64).</summary>
    public static int ReadCpuType(nint header) => Marshal.ReadInt32(header, 4);

    private static int[]? GetFunctionStarts(nint header)
    {
        lock (FunctionStartsLock)
        {
            if (_functionStartsModule == header && _functionStarts is not null) return _functionStarts;
            _functionStarts = ParseFunctionStarts(header);
            _functionStartsModule = header;
            return _functionStarts;
        }
    }

    private static int[]? ParseFunctionStarts(nint header)
    {
        if (!TryLocateFunctionStarts(header, out var data, out var dataSize)) return null;
        if (!TryQueryRegion(data, out _, out var regionEnd, out var readable) || !readable ||
            (ulong)data + dataSize > regionEnd)
            return null;

        var bytes = new byte[dataSize];
        Marshal.Copy(data, bytes, 0, (int)dataSize);
        return DecodeFunctionStarts(bytes);
    }

    /// <summary>
    /// Where the mapped LC_FUNCTION_STARTS table sits in memory. The table lives in
    /// __LINKEDIT, so its file offset maps to memory through that segment's own
    /// vmaddr/fileoff pair plus the image slide.
    /// </summary>
    internal static bool TryLocateFunctionStarts(nint header, out nint data, out uint dataSize)
    {
        data = default;
        dataSize = 0;
        if (!TryReadHeader(header, out var commands, out var commandCount, out _)) return false;

        ulong? textVmAddress = null;
        ulong linkEditVmAddress = 0, linkEditFileOffset = 0, linkEditFileSize = 0;
        var haveLinkEdit = false;
        uint dataOffset = 0;
        var haveFunctionStarts = false;
        var cursor = commands;
        for (var i = 0; i < commandCount; i++)
        {
            var command = (uint)Marshal.ReadInt32(cursor);
            var size = (uint)Marshal.ReadInt32(cursor, 4);
            if (size < 8) return false;
            if (command == LcSegment64)
            {
                var name = ReadFixedString(cursor + 8, 16);
                if (name == "__TEXT") textVmAddress = (ulong)Marshal.ReadInt64(cursor, 24);
                if (name == "__LINKEDIT")
                {
                    linkEditVmAddress = (ulong)Marshal.ReadInt64(cursor, 24);
                    linkEditFileOffset = (ulong)Marshal.ReadInt64(cursor, 40);
                    linkEditFileSize = (ulong)Marshal.ReadInt64(cursor, 48);
                    haveLinkEdit = true;
                }
            }
            else if (command == LcFunctionStarts)
            {
                dataOffset = (uint)Marshal.ReadInt32(cursor, 8);
                dataSize = (uint)Marshal.ReadInt32(cursor, 12);
                haveFunctionStarts = true;
            }

            cursor += (int)size;
        }

        if (textVmAddress is not { } textBase || !haveLinkEdit || !haveFunctionStarts ||
            dataOffset < linkEditFileOffset || dataOffset + (ulong)dataSize > linkEditFileOffset + linkEditFileSize)
            return false;

        var slide = (ulong)header - textBase;
        data = (nint)(long)(slide + linkEditVmAddress + (dataOffset - linkEditFileOffset));
        return true;
    }

    /// <summary>
    /// LC_FUNCTION_STARTS is a run of ULEB128 deltas. The first delta is measured
    /// from the start of __TEXT, so cumulative values are RVAs. A zero delta ends it.
    /// </summary>
    internal static int[] DecodeFunctionStarts(ReadOnlySpan<byte> data)
    {
        var starts = new List<int>();
        ulong address = 0;
        var position = 0;
        while (position < data.Length)
        {
            ulong delta = 0;
            var shift = 0;
            byte value;
            do
            {
                if (position >= data.Length || shift > 63) return starts.ToArray();
                value = data[position++];
                delta |= (ulong)(value & 0x7F) << shift;
                shift += 7;
            } while ((value & 0x80) != 0);

            if (delta == 0) break;
            address += delta;
            if (address > int.MaxValue) break;
            starts.Add((int)address);
        }

        return starts.ToArray();
    }

    private static bool TryReadHeader(nint header, out nint commands, out int commandCount, out string failure)
    {
        commands = default;
        commandCount = 0;
        if (header == default)
        {
            failure = "image header is null";
            return false;
        }

        var magic = (uint)Marshal.ReadInt32(header);
        if (magic != MhMagic64)
        {
            failure = $"image is not a 64-bit Mach-O (magic 0x{magic:X8})";
            return false;
        }

        commandCount = Marshal.ReadInt32(header, 16);
        commands = header + 32;
        failure = string.Empty;
        return true;
    }

    private static string ReadFixedString(nint address, int length)
    {
        var bytes = new byte[length];
        Marshal.Copy(address, bytes, 0, length);
        var end = Array.IndexOf(bytes, (byte)0);
        return System.Text.Encoding.ASCII.GetString(bytes, 0, end < 0 ? length : end);
    }

    private static uint TaskSelf()
    {
        if (_taskSelf is { } task) return task;
        // mach_task_self() is a macro over the exported mach_task_self_ variable.
        var library = NativeLibrary.Load(LibSystem);
        var symbol = NativeLibrary.GetExport(library, "mach_task_self_");
        task = (uint)Marshal.ReadInt32(symbol);
        _taskSelf = task;
        return task;
    }

    // vm_region_basic_info_64 is declared under #pragma pack(4) in mach/vm_region.h.
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct VmRegionBasicInfo64
    {
        public int Protection;
        public int MaxProtection;
        public uint Inheritance;
        public int Shared;
        public int Reserved;
        public ulong Offset;
        public int Behavior;
        public ushort UserWiredCount;
    }

    [DllImport(LibSystem)]
    private static extern uint _dyld_image_count();

    [DllImport(LibSystem)]
    private static extern nint _dyld_get_image_header(uint imageIndex);

    [DllImport(LibSystem)]
    private static extern nint _dyld_get_image_name(uint imageIndex);

    [DllImport(LibSystem)]
    private static extern int mach_vm_region(
        uint targetTask,
        ref ulong address,
        ref ulong size,
        int flavor,
        out VmRegionBasicInfo64 info,
        ref uint infoCount,
        out uint objectName);
}
