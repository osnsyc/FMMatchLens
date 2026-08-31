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
    private ArchiveWriter? _archiveWriter;
    private string? _currentMatchId;
    private string? _currentHomeName;
    private string? _currentAwayName;

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
                var path = GetPath(matchId);
                _archiveWriter = new ArchiveWriter(path, matchId, startedUnixMilliseconds, _options);
                _currentMatchId = matchId;
                _currentHomeName = null;
                _currentAwayName = null;
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
            _archiveWriter.WriteMetadata(metadata);
        }
    }

    public void Complete(string matchId)
    {
        lock (_gate)
        {
            if (_archiveWriter is null || matchId != _currentMatchId) return;
            var path = GetPath(matchId);
            var homeName = _currentHomeName;
            var awayName = _currentAwayName;
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
            path = TryAppendTeamNames(path, matchId, homeName, awayName);
            ArchiveDiagnostics.Info($"GAME_MATCH archive finalized and closed: {path}.");
        }
    }

    public IReadOnlyList<MatchArchiveSummary> List()
    {
        lock (_gate)
        {
            var result = new List<MatchArchiveSummary>();
            foreach (var path in Directory.EnumerateFiles(_directory, "*.fmlens", SearchOption.TopDirectoryOnly))
            {
                if (ArchiveReader.TryScan(path, 0, null, 1, 0, materialize: false, out var scan))
                    result.Add(scan.Summary);
            }
            return result.OrderByDescending(item => item.StartedUnixMilliseconds).ToArray();
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
        return Directory.EnumerateFiles(_directory, $"{matchId}-*.fmlens", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault() ?? original;
    }

    private string TryAppendTeamNames(string path, string matchId, string? homeName, string? awayName)
    {
        if (string.IsNullOrWhiteSpace(homeName) || string.IsNullOrWhiteSpace(awayName)) return path;
        try
        {
            var fileName = $"{matchId}-{SafeFileNamePart(homeName)}-vs-{SafeFileNamePart(awayName)}.fmlens";
            var renamedPath = Path.Combine(_directory, fileName);
            if (string.Equals(path, renamedPath, StringComparison.OrdinalIgnoreCase)) return path;
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

    private static bool IsSafeMatchId(string matchId) =>
        matchId.Length is > 0 and <= 80 && matchId.All(character => char.IsLetterOrDigit(character) || character is '-' or '_');

    private void CloseWriterLocked()
    {
        _archiveWriter?.Dispose();
        _archiveWriter = null;
        _currentMatchId = null;
        _currentHomeName = null;
        _currentAwayName = null;
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
    int HomeGoals,
    int AwayGoals,
    long FileSizeBytes);

internal sealed record ArchivedFrameSlice(
    MatchArchiveSummary Archive,
    RealtimeMatchMetadata? Metadata,
    IReadOnlyList<RealtimeMatchMetadata> MetadataTimeline,
    IReadOnlyList<RealtimeTickFrame> Frames);
