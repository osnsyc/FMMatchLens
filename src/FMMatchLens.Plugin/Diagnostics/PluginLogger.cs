namespace FMMatchLens.Plugin.Diagnostics;

internal static class PluginLogger
{
    private static bool _debugEnabled;

    public static bool IsDebugEnabled => _debugEnabled;

    public static string Mode => _debugEnabled ? "debug" : "release";

    public static bool Configure(string? mode)
    {
        if (string.Equals(mode?.Trim(), "debug", StringComparison.OrdinalIgnoreCase))
        {
            _debugEnabled = true;
            return true;
        }

        _debugEnabled = false;
        return string.IsNullOrWhiteSpace(mode) ||
               string.Equals(mode.Trim(), "release", StringComparison.OrdinalIgnoreCase);
    }

    public static void Info(string message) => Plugin.PluginLog.LogInfo(message);

    public static void Debug(string message)
    {
        if (_debugEnabled)
        {
            // Keep debug-mode details at Info severity so BepInEx's default disk
            // listener records them without requiring a second global setting.
            Plugin.PluginLog.LogInfo(message);
        }
    }

    public static void Warning(string message) => Plugin.PluginLog.LogWarning(message);

    public static void Error(string message) => Plugin.PluginLog.LogError(message);
}
