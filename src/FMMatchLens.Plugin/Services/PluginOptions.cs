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

        ArchiveCompression = config.Bind(
            "Archive",
            "Compression",
            "Fast",
            "Archive chunk compression: None or Fast (independent zlib-wrapped Deflate chunks).");

        ArchiveChunkTicks = config.Bind(
            "Archive",
            "ChunkTicks",
            2_400,
            "Maximum number of captured ticks in each independently recoverable archive chunk. At 4 ticks per second, this is about 10 in-game minutes.");

        ArchiveMaxChunkLatencyMs = config.Bind(
            "Archive",
            "MaxChunkLatencyMs",
            60_000,
            "Maximum time before a partial archive chunk is submitted to the background writer. At 60 seconds, the tick limit normally seals the chunk first.");

        ArchiveQueueCapacity = config.Bind(
            "Archive",
            "QueueCapacity",
            8,
            "Bounded archive writer queue capacity. A sustained overflow stops the current archive explicitly.");
    }

    public ConfigEntry<string> LogMode { get; }

    public ConfigEntry<string> GraphicsPath { get; }

    public ConfigEntry<string> ArchiveCompression { get; }

    public ConfigEntry<int> ArchiveChunkTicks { get; }

    public ConfigEntry<int> ArchiveMaxChunkLatencyMs { get; }

    public ConfigEntry<int> ArchiveQueueCapacity { get; }

    public ArchiveWriteOptions GetArchiveWriteOptions()
    {
        var compression = string.Equals(ArchiveCompression.Value, "None", StringComparison.OrdinalIgnoreCase)
            ? global::FMMatchLens.Plugin.Services.ArchiveCompression.None
            : global::FMMatchLens.Plugin.Services.ArchiveCompression.Deflate;
        return new ArchiveWriteOptions(
            compression,
            Math.Clamp(ArchiveChunkTicks.Value, 1, 4_096),
            Math.Clamp(ArchiveMaxChunkLatencyMs.Value, 100, 60_000),
            Math.Clamp(ArchiveQueueCapacity.Value, 1, 64));
    }
}
