namespace FMMatchLens.Plugin.Diagnostics;

// Only the game log sink is substituted. Capture/timeline/archive/SDK logic is compiled unchanged.
internal static class PluginLogger
{
    public static void Warning(string message) { }
    public static void Debug(string message) { }
    public static void Info(string message) { }
}
