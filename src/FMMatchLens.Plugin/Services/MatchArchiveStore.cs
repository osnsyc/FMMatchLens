using FMMatchLens.Plugin.Domain;

namespace FMMatchLens.Plugin.Services;

/// <summary>
/// Owns the single supported append-only archive writer and reader.
/// Complete chunks remain readable after an abnormal shutdown.
/// </summary>
internal sealed class MatchArchiveStore : IDisposable
{
    private readonly object _gate = new();
    private readonly string _directory;
    private readonly ArchiveWriteOptions _options;
    private readonly Dictionary<string, CachedArchiveSummary> _summaryCache = new(StringComparer.OrdinalIgnoreCase);
    private ArchiveWriter? _archiveWriter;
    private string? _currentMatchId;
    private string? _currentPath;
    private string? _currentHomeName;
    private string? _currentAwayName;
    private string? _currentMatchDate;
    private int _currentHomeGoals;
    private int _currentAwayGoals;

    public MatchArchiveStore(string directory, ArchiveWriteOptions? options = null)
    {
        _directory = directory;
        _options = options ?? ArchiveWriteOptions.Default;
        Directory.CreateDirectory(_directory);
        ArchiveDiagnostics.Debug($"Match archives will be stored in {_directory}.");
    }

    public string DirectoryPath => _directory;

    public void Begin(string matchId, long startedUnixMilliseconds)
    {
        lock (_gate)
        {
            CloseWriterLocked();
            try
            {
                var path = GetAvailablePath(GetPath(matchId));
                _archiveWriter = new ArchiveWriter(path, matchId, startedUnixMilliseconds, _options);
                _currentMatchId = matchId;
                _currentPath = path;
                _currentHomeName = null;
                _currentAwayName = null;
                _currentMatchDate = null;
                _currentHomeGoals = 0;
                _currentAwayGoals = 0;
                ArchiveDiagnostics.Debug($"GAME_MATCH archive opened: {path}.");
            }
            catch (Exception ex)
            {
                CloseWriterLocked();
                ArchiveDiagnostics.Warning($"Unable to open GAME_MATCH archive: {ex.Message}");
            }
        }
    }

    public void Append(RealtimeTickFrame frame)
    {
        lock (_gate)
        {
            if (_archiveWriter is null || frame.MatchId != _currentMatchId) return;
            _archiveWriter.Append(frame);
            _currentHomeGoals = frame.Home.Goals;
            _currentAwayGoals = frame.Away.Goals;
        }
    }

    public void WriteMetadata(RealtimeMatchMetadata metadata)
    {
        lock (_gate)
        {
            if (_archiveWriter is null || metadata.MatchId != _currentMatchId) return;
            if (!string.IsNullOrWhiteSpace(metadata.Home.Name) && metadata.Home.Name != "Home")
                _currentHomeName = metadata.Home.Name;
            if (!string.IsNullOrWhiteSpace(metadata.Away.Name) && metadata.Away.Name != "Away")
                _currentAwayName = metadata.Away.Name;
            if (!string.IsNullOrWhiteSpace(metadata.MatchDate))
                _currentMatchDate = metadata.MatchDate;
            _archiveWriter.WriteMetadata(metadata);
        }
    }

    public void Complete(string matchId)
    {
        lock (_gate)
        {
            if (_archiveWriter is null || matchId != _currentMatchId) return;
            var path = _currentPath ?? GetPath(matchId);
            var homeName = _currentHomeName;
            var awayName = _currentAwayName;
            var matchDate = _currentMatchDate;
            var homeGoals = _currentHomeGoals;
            var awayGoals = _currentAwayGoals;
            var finalized = false;
            try
            {
                _archiveWriter.Complete(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                finalized = true;
            }
            catch (Exception ex)
            {
                ArchiveDiagnostics.Warning($"Unable to finalize GAME_MATCH archive {path}: {ex.Message}");
            }
            finally
            {
                CloseWriterLocked();
            }

            if (!finalized) return;
            path = TrySetFinalFileName(path, matchId, matchDate, homeName, awayName, homeGoals, awayGoals);
            ArchiveDiagnostics.Info($"GAME_MATCH archive finalized and closed: {path}.");
        }
    }

    public MatchArchivePage List(int page, int pageSize)
    {
        lock (_gate)
        {
            var result = new List<MatchArchiveSummary>();
            var existingPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in Directory.EnumerateFiles(_directory, "*.fmlens", SearchOption.TopDirectoryOnly))
            {
                existingPaths.Add(path);
                var info = new FileInfo(path);
                if (_summaryCache.TryGetValue(path, out var cached) &&
                    cached.Length == info.Length &&
                    cached.LastWriteTimeUtc == info.LastWriteTimeUtc)
                {
                    result.Add(cached.Summary);
                    continue;
                }
                if (!ArchiveReader.TryScan(path, 0, null, 1, 0, materialize: false, out var scan)) continue;
                result.Add(scan.Summary);
                _summaryCache[path] = new CachedArchiveSummary(info.Length, info.LastWriteTimeUtc, scan.Summary);
            }
            foreach (var stalePath in _summaryCache.Keys.Where(path => !existingPaths.Contains(path)).ToArray())
                _summaryCache.Remove(stalePath);
            pageSize = Math.Clamp(pageSize, 1, 50);
            var ordered = result.OrderByDescending(item => item.StartedUnixMilliseconds).ToArray();
            var pageCount = Math.Max(1, (int)Math.Ceiling(ordered.Length / (double)pageSize));
            page = Math.Clamp(page, 0, pageCount - 1);
            var items = ordered.Skip(page * pageSize).Take(pageSize).ToArray();
            return new MatchArchivePage(items, page, pageSize, ordered.Length, pageCount);
        }
    }

    public bool TryReadFrames(string matchId, int fromTick, int? toTick, int stride, int limit, out ArchivedFrameSlice slice)
    {
        slice = default!;
        if (!IsSafeMatchId(matchId)) return false;
        lock (_gate)
        {
            stride = Math.Clamp(stride, 1, 1_000);
            limit = Math.Clamp(limit, 1, 10_000);
            if (!ArchiveReader.TryScan(FindPath(matchId), fromTick, toTick, stride, limit, materialize: true, out var scan))
                return false;
            slice = new ArchivedFrameSlice(scan.Summary, scan.Metadata, scan.MetadataTimeline, scan.Frames);
            return true;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            CloseWriterLocked();
        }
    }

    private string GetPath(string matchId) => Path.Combine(_directory, $"{matchId}.fmlens");

    private string FindPath(string matchId)
    {
        var original = GetPath(matchId);
        if (File.Exists(original)) return original;
        var legacy = Directory.EnumerateFiles(_directory, $"{matchId}-*.fmlens", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
        if (legacy is not null) return legacy;

        foreach (var path in Directory.EnumerateFiles(_directory, "*.fmlens", SearchOption.TopDirectoryOnly)
                     .OrderByDescending(File.GetLastWriteTimeUtc))
        {
            try
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (ArchiveReader.ReadHeader(stream).MatchId == matchId) return path;
            }
            catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException or IOException or OverflowException)
            {
                // Ignore unrelated or incomplete archives while resolving by the embedded match id.
            }
        }

        return original;
    }

    private string TrySetFinalFileName(
        string path,
        string matchId,
        string? matchDate,
        string? homeName,
        string? awayName,
        int homeGoals,
        int awayGoals)
    {
        if (string.IsNullOrWhiteSpace(homeName) || string.IsNullOrWhiteSpace(awayName)) return path;
        try
        {
            var fileName = string.IsNullOrWhiteSpace(matchDate)
                ? $"{matchId}-{SafeFileNamePart(homeName)}-vs-{SafeFileNamePart(awayName)}.fmlens"
                : $"{SafeFileNamePart(matchDate)}-{SafeFileNamePart(homeName)}-vs-{SafeFileNamePart(awayName)}-{homeGoals}-{awayGoals}.fmlens";
            var renamedPath = Path.Combine(_directory, fileName);
            if (string.Equals(path, renamedPath, StringComparison.OrdinalIgnoreCase)) return path;
            renamedPath = GetAvailablePath(renamedPath);
            File.Move(path, renamedPath);
            return renamedPath;
        }
        catch (Exception ex)
        {
            ArchiveDiagnostics.Warning($"Unable to append team names to archive {Path.GetFileName(path)}: {ex.Message}");
            return path;
        }
    }

    private static string SafeFileNamePart(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Trim().Select(character =>
            invalid.Contains(character) || char.IsControl(character) ? '_' : character).ToArray());
        sanitized = string.Join(' ', sanitized.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim('.', ' ');
        if (sanitized.Length > 48) sanitized = sanitized[..48].TrimEnd('.', ' ');
        return string.IsNullOrWhiteSpace(sanitized) ? "Unknown" : sanitized;
    }

    private static string GetAvailablePath(string path)
    {
        if (!File.Exists(path)) return path;

        var directory = Path.GetDirectoryName(path) ?? string.Empty;
        var stem = Path.GetFileNameWithoutExtension(path);
        var extension = Path.GetExtension(path);
        for (var suffix = 1; ; suffix++)
        {
            var candidate = Path.Combine(directory, $"{stem}_{suffix}{extension}");
            if (!File.Exists(candidate)) return candidate;
        }
    }

    private static bool IsSafeMatchId(string matchId) =>
        matchId.Length is > 0 and <= 80 && matchId.All(character => char.IsLetterOrDigit(character) || character is '-' or '_');

    private void CloseWriterLocked()
    {
        _archiveWriter?.Dispose();
        _archiveWriter = null;
        _currentMatchId = null;
        _currentPath = null;
        _currentHomeName = null;
        _currentAwayName = null;
        _currentMatchDate = null;
        _currentHomeGoals = 0;
        _currentAwayGoals = 0;
    }
}

internal sealed record MatchArchiveSummary(
    string MatchId,
    string FileName,
    long StartedUnixMilliseconds,
    long? EndedUnixMilliseconds,
    bool Ended,
    int FrameCount,
    int FirstTick,
    int LastTick,
    string? HomeName,
    string? AwayName,
    string? MatchDate,
    int HomeGoals,
    int AwayGoals,
    bool? HomeManagerIsHumanControlled,
    bool? AwayManagerIsHumanControlled,
    ArchivePlayerResult? PlayerResult,
    long FileSizeBytes);

internal enum ArchivePlayerResult
{
    Win,
    Draw,
    Loss
}

internal sealed record MatchArchivePage(
    IReadOnlyList<MatchArchiveSummary> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int PageCount);

internal readonly record struct CachedArchiveSummary(
    long Length,
    DateTime LastWriteTimeUtc,
    MatchArchiveSummary Summary);

internal sealed record ArchivedFrameSlice(
    MatchArchiveSummary Archive,
    RealtimeMatchMetadata? Metadata,
    IReadOnlyList<RealtimeMatchMetadata> MetadataTimeline,
    IReadOnlyList<RealtimeTickFrame> Frames);
