using FMMatchLens.Plugin.Diagnostics;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Xml;

namespace FMMatchLens.Plugin.Services;

internal sealed class GraphicsAssetIndex
{
    private static readonly string[] SupportedExtensions =
    {
        ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"
    };

    private static readonly JsonSerializerOptions CacheJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private readonly string _graphicsRoot;
    private readonly string _cachePath;
    private Dictionary<string, string> _assets = new(StringComparer.OrdinalIgnoreCase);

    public GraphicsAssetIndex(string graphicsRoot, string cachePath)
    {
        _graphicsRoot = NormalizeRoot(graphicsRoot);
        _cachePath = cachePath;
    }

    public int ConfigCount { get; private set; }

    public int AssetCount => _assets.Count;

    public void Build()
    {
        var timer = Stopwatch.StartNew();
        if (string.IsNullOrWhiteSpace(_graphicsRoot) || !Directory.Exists(_graphicsRoot))
        {
            PluginLogger.Warning(
                $"Graphics index skipped because the directory does not exist: {_graphicsRoot} " +
                $"({timer.ElapsedMilliseconds:N0} ms).");
            return;
        }

        PluginLogger.Info($"Graphics index build started for '{_graphicsRoot}'.");
        var cacheLoadTimer = Stopwatch.StartNew();
        var previous = LoadCache();
        var rootLastWriteTime = Directory.GetLastWriteTimeUtc(_graphicsRoot).ToString("O", CultureInfo.InvariantCulture);
        var reusedDiscovery = previous.GraphicsRootLastWriteTimeUtc == rootLastWriteTime
            && previous.Configs.Keys.All(File.Exists);
        cacheLoadTimer.Stop();
        PluginLogger.Info($"Graphics index cache checked in {cacheLoadTimer.ElapsedMilliseconds:N0} ms.");
        var discoveryTimer = Stopwatch.StartNew();
        var configPaths = (reusedDiscovery
                ? previous.Configs.Keys
                : DiscoverConfigFiles(_graphicsRoot))
            .OrderBy(path => Path.GetRelativePath(_graphicsRoot, path), StringComparer.OrdinalIgnoreCase)
            .ToArray();
        discoveryTimer.Stop();
        PluginLogger.Info(
            $"Graphics config discovery {(reusedDiscovery ? "restored" : "completed")}: " +
            $"{configPaths.Length:N0} configs in {discoveryTimer.ElapsedMilliseconds:N0} ms.");
        var indexingTimer = Stopwatch.StartNew();
        var nextConfigs = new Dictionary<string, CachedConfig>(StringComparer.OrdinalIgnoreCase);
        var assets = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var reused = 0;
        var reparsed = 0;

        foreach (var configPath in configPaths)
        {
            try
            {
                var file = new FileInfo(configPath);
                var lastWriteTime = file.LastWriteTimeUtc.ToString("O", CultureInfo.InvariantCulture);
                CachedConfig cached;
                if (previous.Configs.TryGetValue(configPath, out var existing)
                    && existing.LastWriteTimeUtc == lastWriteTime
                    && existing.Length == file.Length)
                {
                    cached = existing;
                    reused++;
                }
                else
                {
                    cached = new CachedConfig
                    {
                        LastWriteTimeUtc = lastWriteTime,
                        Length = file.Length,
                        Entries = ParseConfig(configPath)
                    };
                    reparsed++;
                }

                nextConfigs[configPath] = cached;
                foreach (var entry in cached.Entries ?? new List<CachedAssetEntry>())
                {
                    if (!string.IsNullOrWhiteSpace(entry.Target) && !string.IsNullOrWhiteSpace(entry.SourcePath))
                    {
                        assets[entry.Target] = entry.SourcePath;
                    }
                }
            }
            catch (Exception ex)
            {
                PluginLogger.Warning($"Could not index graphics config '{configPath}': {ex.Message}");
            }
        }

        indexingTimer.Stop();
        PluginLogger.Info(
            $"Graphics configs indexed: {assets.Count:N0} assets " +
            $"({reused:N0} cached, {reparsed:N0} parsed) in {indexingTimer.ElapsedMilliseconds:N0} ms.");
        _assets = assets;
        ConfigCount = configPaths.Length;
        var cacheWriteTimer = Stopwatch.StartNew();
        var wroteCache = false;
        if (!reusedDiscovery || reparsed > 0 || previous.Configs.Count != nextConfigs.Count)
        {
            SaveCache(new GraphicsIndexCache
            {
                GraphicsRoot = _graphicsRoot,
                GraphicsRootLastWriteTimeUtc = rootLastWriteTime,
                Configs = nextConfigs
            });
            wroteCache = true;
        }
        cacheWriteTimer.Stop();
        PluginLogger.Info(
            $"Graphics index ready: {AssetCount:N0} assets from {ConfigCount:N0} configs " +
            $"({reused:N0} cached, {reparsed:N0} parsed, discovery {(reusedDiscovery ? "cached" : "scanned")}) " +
            $"in {timer.ElapsedMilliseconds:N0} ms " +
            $"(cache load {cacheLoadTimer.ElapsedMilliseconds:N0} ms, " +
            $"discovery {discoveryTimer.ElapsedMilliseconds:N0} ms, " +
            $"indexing {indexingTimer.ElapsedMilliseconds:N0} ms, " +
            $"cache write {(wroteCache ? $"{cacheWriteTimer.ElapsedMilliseconds:N0} ms" : "skipped")}).");
    }

    public bool TryResolve(string entityType, uint uid, string imageType, out string path)
    {
        var key = BuildTargetKey(entityType, uid.ToString(CultureInfo.InvariantCulture), imageType);
        if (!_assets.TryGetValue(key, out var cachedPath))
        {
            path = string.Empty;
            return false;
        }

        try
        {
            var candidate = Path.GetFullPath(cachedPath);
            if (!IsUnderGraphicsRoot(candidate))
            {
                path = string.Empty;
                return false;
            }

            if (Path.HasExtension(candidate))
            {
                path = candidate;
                return File.Exists(path);
            }

            foreach (var extension in SupportedExtensions)
            {
                var withExtension = candidate + extension;
                if (File.Exists(withExtension))
                {
                    path = withExtension;
                    return true;
                }
            }

            path = string.Empty;
            return false;
        }
        catch
        {
            path = string.Empty;
            return false;
        }
    }

    private List<CachedAssetEntry> ParseConfig(string configPath)
    {
        var entries = new List<CachedAssetEntry>();
        var configDirectory = Path.GetDirectoryName(configPath)!;
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            IgnoreComments = true,
            IgnoreWhitespace = true
        };

        using var stream = new FileStream(configPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = XmlReader.Create(stream, settings);
        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element || !reader.Name.Equals("record", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var from = reader.GetAttribute("from");
            var to = reader.GetAttribute("to");
            if (!TryNormalizeTarget(to, out var target) || !TryResolveSource(configDirectory, from, out var sourcePath))
            {
                continue;
            }

            entries.Add(new CachedAssetEntry { Target = target, SourcePath = sourcePath });
        }

        return entries;
    }

    private bool TryResolveSource(string configDirectory, string? from, out string sourcePath)
    {
        sourcePath = string.Empty;
        if (string.IsNullOrWhiteSpace(from))
        {
            return false;
        }

        var relative = from.Trim().Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
        var candidate = Path.GetFullPath(Path.Combine(configDirectory, relative));
        if (!IsUnderGraphicsRoot(candidate))
        {
            return false;
        }

        // Do not probe the filesystem while indexing. Large face packs can contain
        // more than a million mappings, so checking every source blocks BepInEx's
        // startup thread. Extension discovery and existence validation are deferred
        // until the individual asset is requested by TryResolve.
        sourcePath = candidate;
        return true;
    }

    private bool IsUnderGraphicsRoot(string path)
    {
        var rootWithSeparator = _graphicsRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        return path.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryNormalizeTarget(string? value, out string target)
    {
        target = string.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var segments = value.Trim().Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 5
            || !segments[0].Equals("graphics", StringComparison.OrdinalIgnoreCase)
            || !segments[1].Equals("pictures", StringComparison.OrdinalIgnoreCase)
            || !uint.TryParse(segments[3], NumberStyles.None, CultureInfo.InvariantCulture, out _))
        {
            return false;
        }

        target = BuildTargetKey(segments[2], segments[3], string.Join('/', segments.Skip(4)));
        return true;
    }

    private static string BuildTargetKey(string entityType, string uid, string imageType)
    {
        return $"{entityType.Trim().ToLowerInvariant()}/{uid}/{imageType.Trim().Trim('/').ToLowerInvariant()}";
    }

    private static IEnumerable<string> DiscoverConfigFiles(string root)
    {
        var directories = new Stack<string>();
        directories.Push(root);
        while (directories.Count > 0)
        {
            var directory = directories.Pop();
            var configPath = Path.Combine(directory, "config.xml");
            if (File.Exists(configPath))
            {
                yield return configPath;
            }

            string[] children;
            try
            {
                children = Directory.GetDirectories(directory);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                PluginLogger.Warning($"Could not scan graphics directory '{directory}': {ex.Message}");
                continue;
            }

            Array.Sort(children, StringComparer.OrdinalIgnoreCase);
            for (var index = children.Length - 1; index >= 0; index--)
            {
                directories.Push(children[index]);
            }
        }
    }

    private GraphicsIndexCache LoadCache()
    {
        try
        {
            if (!File.Exists(_cachePath))
            {
                return new GraphicsIndexCache();
            }

            var cache = JsonSerializer.Deserialize<GraphicsIndexCache>(File.ReadAllText(_cachePath), CacheJsonOptions);
            if (cache is null || !cache.GraphicsRoot.Equals(_graphicsRoot, StringComparison.OrdinalIgnoreCase))
            {
                return new GraphicsIndexCache();
            }

            cache.Configs = new Dictionary<string, CachedConfig>(
                cache.Configs ?? new Dictionary<string, CachedConfig>(),
                StringComparer.OrdinalIgnoreCase);
            return cache;
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Could not load graphics index cache: {ex.Message}");
            return new GraphicsIndexCache();
        }
    }

    private void SaveCache(GraphicsIndexCache cache)
    {
        try
        {
            var directory = Path.GetDirectoryName(_cachePath)!;
            Directory.CreateDirectory(directory);
            var temporaryPath = _cachePath + ".tmp";
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(cache, CacheJsonOptions));
            File.Move(temporaryPath, _cachePath, true);
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Could not save graphics index cache: {ex.Message}");
        }
    }

    private static string NormalizeRoot(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        return Path.GetFullPath(Environment.ExpandEnvironmentVariables(value.Trim().Trim('"')));
    }

    private sealed class GraphicsIndexCache
    {
        public string GraphicsRoot { get; set; } = string.Empty;

        public string GraphicsRootLastWriteTimeUtc { get; set; } = string.Empty;

        public Dictionary<string, CachedConfig> Configs { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class CachedConfig
    {
        public string LastWriteTimeUtc { get; set; } = string.Empty;

        public long Length { get; set; }

        public List<CachedAssetEntry> Entries { get; set; } = new();
    }

    private sealed class CachedAssetEntry
    {
        public string Target { get; set; } = string.Empty;

        public string SourcePath { get; set; } = string.Empty;
    }
}
