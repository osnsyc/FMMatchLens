using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

internal static class GamePluginBuildCatalog
{
    private const int MaximumWindowsPathLength = 32_768;
    private static readonly GamePluginBuild[] SupportedBuilds =
    [
        new(
            "steam-26340721",
            "252ff8fb5b7a4a5a5464db6ba632e309eef9b6e65ffa992ae20575a189e66c6a",
            0x4520BD0),
        new(
            "steam-26227640",
            "bc940e472418fc5c214208d7cf30fecf600f689b6f9d71c11ba19a2df0fe057f",
            0x451ED90),
    ];

    public static bool TryResolve(
        nint moduleHandle,
        out GamePluginBuild build,
        out string modulePath,
        out string sha256)
    {
        modulePath = GetModulePath(moduleHandle);
        using var stream = new FileStream(
            modulePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            bufferSize: 1024 * 1024,
            FileOptions.SequentialScan);
        using var algorithm = SHA256.Create();
        sha256 = Convert.ToHexString(algorithm.ComputeHash(stream)).ToLowerInvariant();
        return TryResolveHash(sha256, out build);
    }

    internal static bool TryResolveHash(string sha256, out GamePluginBuild build)
    {
        foreach (var candidate in SupportedBuilds)
        {
            if (string.Equals(candidate.Sha256, sha256, StringComparison.OrdinalIgnoreCase))
            {
                build = candidate;
                return true;
            }
        }

        build = default;
        return false;
    }

    // Only an exact hash match verifies the rest of the binary's memory layout.
    // A signature match locates the hook alone; callers must keep that distinction.
    internal static bool TryResolveAob(
        nint moduleHandle, string modulePath, string sha256,
        out GamePluginBuild build, out string failure)
    {
        build = default;
        failure = "GAME_MATCH entry AOB was not found";
        using var stream = File.Open(modulePath, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var image = new PEReader(stream);
        if (image.PEHeaders.PEHeader is not { Magic: PEMagic.PE32Plus } header)
        {
            failure = "game_plugin.dll is not a PE32+ image";
            return false;
        }

        // Scan the loaded executable sections, not on-disk bytes or data tables.
        // Overlap chunks so a signature crossing a read boundary is still found.
        var buffer = new byte[1024 * 1024];
        var matchRva = -1;
        foreach (var section in image.PEHeaders.SectionHeaders)
        {
            if ((section.SectionCharacteristics & SectionCharacteristics.MemExecute) == 0)
                continue;
            var start = section.VirtualAddress;
            var size = section.VirtualSize;
            if (start < 0 || size < 0 || (long)start + size > header.SizeOfImage)
            {
                failure = "invalid executable section bounds";
                return false;
            }

            for (var offset = 0; size - offset >= GameMatchTickSignature.Length;)
            {
                var count = Math.Min(buffer.Length, size - offset);
                if (!ReadProcessMemory(GetCurrentProcess(), moduleHandle + start + offset,
                        buffer, (nuint)count, out var read) || read != (nuint)count)
                {
                    failure = "unable to read an executable section for AOB scanning";
                    return false;
                }

                if (!GameMatchTickSignature.Scan(buffer.AsSpan(0, count), start + offset, ref matchRva))
                {
                    failure = "GAME_MATCH entry AOB matched multiple addresses";
                    return false;
                }
                offset += count - GameMatchTickSignature.Length + 1;
            }
        }

        if (matchRva < 0) return false;
        if (!IsFunctionEntry(moduleHandle, matchRva))
        {
            failure = $"AOB match RVA 0x{matchRva:X} is not a function entry";
            return false;
        }

        build = new GamePluginBuild("AOB fallback", sha256, matchRva);
        failure = string.Empty;
        return true;
    }

    // A game update can move the hook target. Detouring an address inside a
    // function corrupts it, so an unverified fallback must land on an entry
    // point recorded in the module's unwind table.
    internal static bool IsFunctionEntry(nint moduleHandle, int rva)
    {
        var address = (ulong)(moduleHandle + rva);
        var functionEntry = RtlLookupFunctionEntry(address, out var imageBase, default);
        if (functionEntry == default || imageBase != (ulong)moduleHandle)
        {
            return false;
        }

        // RUNTIME_FUNCTION starts with the function's BeginAddress RVA.
        return Marshal.ReadInt32(functionEntry) == rva;
    }

    private static string GetModulePath(nint moduleHandle)
    {
        var buffer = new StringBuilder(MaximumWindowsPathLength);
        var length = GetModuleFileName(moduleHandle, buffer, buffer.Capacity);
        if (length == 0)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to locate game_plugin.dll.");
        }

        if (length >= buffer.Capacity - 1)
        {
            throw new PathTooLongException("The game_plugin.dll path exceeds the supported Windows path length.");
        }

        return buffer.ToString();
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetModuleFileName(nint moduleHandle, StringBuilder fileName, int size);

    [DllImport("kernel32.dll")]
    private static extern nint RtlLookupFunctionEntry(ulong controlPc, out ulong imageBase, nint historyTable);

    [DllImport("kernel32.dll")]
    private static extern nint GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadProcessMemory(
        nint process, nint address, [Out] byte[] buffer, nuint size, out nuint bytesRead);
}

internal readonly record struct GamePluginBuild(string Distribution, string Sha256, int MatchTickHookRva);
