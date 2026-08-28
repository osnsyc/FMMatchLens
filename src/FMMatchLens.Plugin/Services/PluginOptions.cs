using BepInEx.Configuration;

namespace FMMatchLens.Plugin.Services;

internal sealed class PluginOptions
{
    public PluginOptions(ConfigFile config)
    {
        LogMode = config.Bind(
            "Logging",
            "Mode",
            "release",
            "Log output mode: release writes only key lifecycle data and warnings/errors; debug also writes detailed diagnostics.");

        GraphicsPath = config.Bind(
            "Graphics",
            "GraphicsPath",
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "Sports Interactive",
                "Football Manager 26",
                "graphics"),
            "Root directory containing Football Manager graphics packs and their config.xml files.");
    }

    public ConfigEntry<string> LogMode { get; }

    public ConfigEntry<string> GraphicsPath { get; }
}
