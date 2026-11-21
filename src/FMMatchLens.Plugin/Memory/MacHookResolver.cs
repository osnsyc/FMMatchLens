using System.Runtime.InteropServices;
using FMMatchLens.Plugin.Diagnostics;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Finds and checks the GAME_MATCH hook target on macOS (Apple Silicon). The macOS BepInEx package runs a
/// re-signed copy of the game, so game_plugin's hash never matches a known build and the arm64 signature
/// is the way in.
/// </summary>
internal static class MacHookResolver
{
    // FM27 (Steam, macOS), arm64: the frame setup, the saved third argument, then the
    // same three GAME_MATCH state checks as on Windows, 0x10 lower in the object:
    //   ldrb [x22+0x2AC] (match+0x15560) == 1, ldrb [x22+0x2AA] (+0x1555E) == 1,
    //   ldrb [x22+0x2B1] (+0x15565) == 0, with x22 = match + 0x152B4.
    // Branch instructions are wildcarded. Matches exactly one function start.
    internal const string MatchTickPatternArm64 =
        "FF 43 02 D1 FC 6F 03 A9 FA 67 04 A9 F8 5F 05 A9 F6 57 06 A9 F4 4F 07 A9 " +
        "FD 7B 08 A9 FD 03 02 91 E2 1F 00 B9 08 54 40 91 16 D1 0A 91 " +
        "C8 B2 4A 39 1F 05 00 71 ? ? ? ? " +
        "C8 AA 4A 39 1F 05 00 71 ? ? ? ? " +
        "C8 C6 4A 39 ? ? ? ?";

    private static bool _moduleLogged;

    /// <summary>The loaded game_plugin image, found through dyld. Logs what was found the first time.</summary>
    internal static nint FindGamePlugin()
    {
        var header = MacNative.FindGamePlugin(out var path, out var candidates);
        if (header == default || _moduleLogged) return header;
        _moduleLogged = true;
        foreach (var candidate in candidates)
            PluginLogger.Info($"[macOS] game_plugin candidate: {candidate.Path} at 0x{candidate.Header:X}.");
        var ranges = MacNative.TryGetExecutableRanges(header, out var found, out var failure)
            ? string.Join(", ", found.Select(range => $"0x{range.Rva:X}+0x{range.Size:X}"))
            : $"unavailable ({failure})";
        PluginLogger.Info(
            $"[macOS] Using {path} at 0x{header:X}: cputype=0x{MacNative.ReadCpuType(header):X8}, " +
            $"function starts={MacNative.CountFunctionStarts(header)}, executable ranges={ranges}.");
        return header;
    }

    /// <summary>macOS counterpart of <see cref="GamePluginBuildCatalog.TryResolveAob"/>.</summary>
    internal static bool TryResolveAob(nint moduleHandle, string sha256, out GamePluginBuild build, out string failure)
    {
        build = default;
        if (!MacNative.TryGetExecutableRanges(moduleHandle, out var ranges, out failure))
            return false;

        // Scan the loaded executable ranges. Overlap chunks so a signature crossing a
        // read boundary is still found.
        var signature = GameMatchTickSignature.MacArm64;
        var buffer = new byte[1024 * 1024];
        var matchRva = -1;
        foreach (var (start, size) in ranges)
        {
            for (var offset = 0; size - offset >= signature.Length;)
            {
                var count = Math.Min(buffer.Length, size - offset);
                var address = moduleHandle + start + offset;
                if (!VirtualMemory.IsReadable(address, count))
                {
                    failure = "unable to read an executable range for AOB scanning";
                    return false;
                }

                Marshal.Copy(address, buffer, 0, count);
                if (!signature.Scan(buffer.AsSpan(0, count), start + offset, ref matchRva))
                {
                    failure = "GAME_MATCH entry AOB matched multiple addresses";
                    return false;
                }
                offset += count - signature.Length + 1;
            }
        }

        if (matchRva < 0)
        {
            failure = "GAME_MATCH entry AOB was not found";
            return false;
        }

        if (!MacNative.IsFunctionEntry(moduleHandle, matchRva))
        {
            failure = $"AOB match RVA 0x{matchRva:X} is not a function entry";
            return false;
        }

        build = new GamePluginBuild($"AOB fallback ({signature.Name})", sha256, matchRva);
        failure = string.Empty;
        return true;
    }

    /// <summary>
    /// macOS counterpart of <see cref="HookInstallDiagnostics.ValidateEntry"/>: there is no VirtualQuery, so check the
    /// entry is mapped and readable through mach_vm_region, and recognise an arm64 B (already detoured).
    /// </summary>
    internal static void ValidateEntry(nint address)
    {
        const int length = 16;
        if (address == 0 || !VirtualMemory.IsReadable(address, length))
            throw new InvalidOperationException("Hook entry is not mapped.");
        var bytes = new byte[length];
        Marshal.Copy(address, bytes, 0, length);
        var jump = (bytes[3] & 0xFC) == 0x14;
        PluginLogger.Info($"Hook entry: address=0x{address:X}, jump={jump}, bytes={Convert.ToHexString(bytes)}.");
    }
}
