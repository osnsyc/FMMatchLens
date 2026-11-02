using System.Collections.Concurrent;
using System.Reflection;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using Side = FMMatchLens.Contracts.TeamSide;

namespace FMMatchLens.Plugin.Sdk;

internal enum DataModule { Full, Motion, Summary, Statistics, Metadata, Momentum }
internal sealed record SourceView(long Epoch, string Session, long Sequence, RealtimeTickFrame Frame,
    RealtimeMatchMetadata? Metadata, Lazy<SnapshotProjector.MetadataProjection?> MetadataProjection)
{
    public SnapshotSource Stamp => new(Session, Frame.MatchId, Sequence, Frame.Tick, Frame.DisplayTick,
        Frame.Period, DateTimeOffset.FromUnixTimeMilliseconds(Frame.CapturedUnixMilliseconds));
}

internal sealed class FrozenSelection
{
    public static readonly FrozenSelection All = new(null);
    private readonly Side? _team;
    private readonly uint[]? _uids;
    public string Key { get; }
    public FrozenSelection(PlayerSelection? selection)
    {
        _team = selection?.Team;
        if (_team is not null && _team is not (Side.Home or Side.Away)) throw new ArgumentException("Invalid team.", nameof(selection));
        _uids = selection?.PlayerUids?.Distinct().OrderBy(id => id).ToArray();
        if (_uids?.Any(id => id == 0) == true) throw new ArgumentException("Player UIDs must be positive.", nameof(selection));
        Key = $"{_team?.ToString() ?? "all"}:{(_uids is null ? "*" : string.Join(',', _uids))}";
    }
    public bool Matches(Side team, long player) => MatchesTeam(team) && MatchesPlayer(player);
    public bool MatchesTeam(Side team) => _team is null || _team == team;
    public bool MatchesPlayer(long? player) => _uids is null || (player is > 0 and <= uint.MaxValue && Array.BinarySearch(_uids, (uint)player.Value) >= 0);
}

internal static partial class SnapshotProjector
{
    public static object ProjectModule(DataModule module, SourceView source, FrozenSelection selection)
    {
        var f = source.Frame;
        var stamp = source.Stamp;
        IEnumerable<PlayerTickData> Selected() => f.Players.Where(p => selection.Matches((Side)p.Team, p.PlayerId));
        switch (module)
        {
            case DataModule.Full:
                return Project(source.Session, source.Sequence, f, source.Metadata, source.MetadataProjection.Value);
            case DataModule.Motion:
                return new MotionSnapshot(stamp, ValidHalf(f.HalfPitchWidth), ValidHalf(f.HalfPitchLength),
                    f.BallPositionValid ? Position(f.BallXCentimeters / 100f, f.BallYCentimeters / 100f,
                        f.BallZCentimeters / 100f, f.HalfPitchWidth, f.HalfPitchLength) : null,
                    f.BallHolderPlayerId, Selected().Select(p => new MotionPlayerSnapshot(p.Slot, p.PlayerId, Uid(p.PlayerId),
                        (Side)p.Team, p.IsOnPitch, p.IsBallHolder,
                        p.PositionValid ? Position(p.X, p.Y, 0, f.HalfPitchWidth, f.HalfPitchLength) : null,
                        p.MovementValid && p.AngleDegrees is <= 360 ? new(p.SpeedCentimetersPerSecond / 100f, p.AngleDegrees.Value) : null)));
            case DataModule.Summary:
                return new SummarySnapshot(stamp, f.Home.Goals, f.Away.Goals,
                    f.PossessionTeam is { } side ? (Side)side : null, f.BallHolderPlayerId);
            case DataModule.Statistics:
                return new StatisticsSnapshot(stamp, ProjectTeamMatchStatistics(f.Home), ProjectTeamMatchStatistics(f.Away),
                    Selected().Select(p => new PlayerStatisticsSnapshot(p.Slot, p.PlayerId, Uid(p.PlayerId), (Side)p.Team, ProjectPlayerMatchStatistics(p))));
            case DataModule.Metadata:
                var projection = source.MetadataProjection.Value;
                MetadataTeamSnapshot TeamInfo(Side team, RealtimeTeamMetadata? raw, TeamMetadataSnapshot? details) =>
                    new(team, raw?.Uid, raw?.Uid is not null || raw?.ClubUid is not null ? raw?.Name : null, details);
                return new MetadataSnapshot(stamp, projection?.Match,
                    TeamInfo(Side.Home, source.Metadata?.Home, projection?.Home),
                    TeamInfo(Side.Away, source.Metadata?.Away, projection?.Away), Selected().Select(p =>
                    {
                        PlayerMetadataEntry? info = null;
                        projection?.Players.TryGetValue(p.Slot, out info);
                        if (info?.PlayerId != p.PlayerId) info = null;
                        return new MetadataPlayerSnapshot(p.Slot, p.PlayerId, Uid(p.PlayerId), (Side)p.Team,
                            info?.DisplayName, info?.ShirtNumber, info?.Details);
                    }));
            case DataModule.Momentum:
                return new MomentumSnapshot(stamp, f.Momentum.Select(Momentum), f.RollingMomentum.Select(Momentum));
            default: throw new ArgumentOutOfRangeException(nameof(module));
        }
    }
    private static uint? Uid(long value) => value is > 0 and <= uint.MaxValue ? (uint)value : null;
}

internal static class ModuleContent
{
    public static bool Same(object a, object b) => (a, b) switch
    {
        (MotionSnapshot x, MotionSnapshot y) => x.HalfPitchWidth == y.HalfPitchWidth && x.HalfPitchLength == y.HalfPitchLength &&
            x.BallPosition == y.BallPosition && x.BallHolderPlayerId == y.BallHolderPlayerId && x.Players.SequenceEqual(y.Players),
        (SummarySnapshot x, SummarySnapshot y) => x.Source.Tick == y.Source.Tick && x.Source.DisplayTick == y.Source.DisplayTick &&
            x.Source.Period == y.Source.Period && x.HomeGoals == y.HomeGoals && x.AwayGoals == y.AwayGoals &&
            x.PossessionTeam == y.PossessionTeam && x.BallHolderPlayerId == y.BallHolderPlayerId,
        (StatisticsSnapshot x, StatisticsSnapshot y) => x.Home == y.Home && x.Away == y.Away && x.Players.SequenceEqual(y.Players),
        (MetadataSnapshot x, MetadataSnapshot y) => DeepSame(x.Match, y.Match) && DeepSame(x.Home, y.Home) &&
            DeepSame(x.Away, y.Away) && DeepSame(x.Players, y.Players),
        (MomentumSnapshot x, MomentumSnapshot y) => x.Momentum.SequenceEqual(y.Momentum) && x.RollingMomentum.SequenceEqual(y.RollingMomentum),
        _ => false,
    };
    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> Properties = new();
    // Compare metadata class DTOs as values; shared immutable children return immediately.
    private static bool DeepSame(object? a, object? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a is null || b is null || a.GetType() != b.GetType()) return false;
        if (a is IReadOnlyDictionary<string, int> da && b is IReadOnlyDictionary<string, int> db)
            return da.Count == db.Count && da.All(p => db.TryGetValue(p.Key, out var value) && value == p.Value);
        if (a is System.Collections.IEnumerable ea && b is System.Collections.IEnumerable eb && a is not string)
        {
            var left = ea.GetEnumerator(); var right = eb.GetEnumerator();
            try
            {
                while (left.MoveNext()) if (!right.MoveNext() || !DeepSame(left.Current, right.Current)) return false;
                return !right.MoveNext();
            }
            finally { (left as IDisposable)?.Dispose(); (right as IDisposable)?.Dispose(); }
        }
        var type = a.GetType();
        if (type.IsValueType || a is string) return a.Equals(b);
        return Properties.GetOrAdd(type, t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            .All(p => DeepSame(p.GetValue(a), p.GetValue(b)));
    }
}
