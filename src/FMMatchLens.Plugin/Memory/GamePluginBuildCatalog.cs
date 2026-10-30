using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace FMMatchLens.Plugin.Memory;

internal static class GamePluginBuildCatalog
{
    private const int MaximumWindowsPathLength = 32_768;
    private const int DefaultMatchTickHookRva = 0x4530BC0;
    private static readonly GamePluginBuild[] SupportedBuilds =
    [
        new(
            "Steam",
            "bc940e472418fc5c214208d7cf30fecf600f689b6f9d71c11ba19a2df0fe057f",
            DefaultMatchTickHookRva),
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

        // Other FM27 distributions may share this layout. Return false to
        // distinguish an unverified fallback from an exact fingerprint match.
        build = new GamePluginBuild("Fallback", sha256, DefaultMatchTickHookRva);
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
