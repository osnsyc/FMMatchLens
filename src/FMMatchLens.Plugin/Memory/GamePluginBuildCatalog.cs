using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

internal static class GamePluginBuildCatalog
{
    private const int MaximumWindowsPathLength = 32_768;

    private static readonly GamePluginBuild[] SupportedBuilds =
    [
        new(
            "Steam",
            "eb6c86fab56e051fe41482c7b93d8cb0af716a1cc2c6197ce1babbff68372bb8",
            0x3E08AD0),
        new(
            "XGP",
            "5de88e91e8c63f7ca1502b44313891d1eed85336c90316b900f8df7a37ad9091",
            0x3CF98D0),
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
}

internal readonly record struct GamePluginBuild(string Distribution, string Sha256, int MatchTickHookRva);
