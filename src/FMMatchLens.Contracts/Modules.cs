namespace FMMatchLens.Contracts;

/// <summary>Stable UID filters are intersected with Team. Null UIDs means all; an empty list selects none.</summary>
public sealed class PlayerSelection
{
    public TeamSide? Team { get; init; }
    public IReadOnlyList<uint>? PlayerUids { get; init; }
}

public abstract class StateSubscriptionOptions
{
    protected StateSubscriptionOptions(double rate, bool changed) { MaxRateHz = rate; OnlyWhenChanged = changed; }
    public double MaxRateHz { get; init; }
    public bool EmitInitial { get; init; } = true;
    public bool OnlyWhenChanged { get; init; }
}
public sealed class MotionSubscriptionOptions() : StateSubscriptionOptions(4, false)
{ public PlayerSelection? Selection { get; init; } }
public sealed class SummarySubscriptionOptions() : StateSubscriptionOptions(4, true);
public sealed class StatisticsSubscriptionOptions() : StateSubscriptionOptions(1, true)
{ public PlayerSelection? Selection { get; init; } }
public sealed class MetadataSubscriptionOptions() : StateSubscriptionOptions(10, true)
{ public PlayerSelection? Selection { get; init; } }
public sealed class MomentumSubscriptionOptions() : StateSubscriptionOptions(1, true);
public sealed class EventSubscriptionOptions
{
    public PlayerSelection? Selection { get; init; }
    public IReadOnlyList<int>? EventTypes { get; init; }
}

public sealed record SnapshotSource(string SessionId, string MatchId, long SourceSequence,
    int Tick, int DisplayTick, int Period, DateTimeOffset CapturedAtUtc);
public interface ILensStateSnapshot { SnapshotSource Source { get; } }

public sealed record MotionPlayerSnapshot(int Slot, long PlayerId, uint? Uid, TeamSide Team,
    bool IsOnPitch, bool IsBallHolder, Position3? Position, PlayerMovementSnapshot? Movement);
public sealed class MotionSnapshot : ILensStateSnapshot
{
    public SnapshotSource Source { get; }
    public float? HalfPitchWidth { get; }
    public float? HalfPitchLength { get; }
    public Position3? BallPosition { get; }
    public long? BallHolderPlayerId { get; }
    public IReadOnlyList<MotionPlayerSnapshot> Players { get; }
    public MotionSnapshot(SnapshotSource source, float? halfPitchWidth, float? halfPitchLength,
        Position3? ballPosition, long? ballHolderPlayerId, IEnumerable<MotionPlayerSnapshot> players)
    {
        Source = source; HalfPitchWidth = halfPitchWidth; HalfPitchLength = halfPitchLength;
        BallPosition = ballPosition; BallHolderPlayerId = ballHolderPlayerId;
        Players = Array.AsReadOnly(players.ToArray());
    }
}
public sealed record SummarySnapshot(SnapshotSource Source, int HomeGoals, int AwayGoals,
    TeamSide? PossessionTeam, long? BallHolderPlayerId) : ILensStateSnapshot;
public sealed record PlayerStatisticsSnapshot(int Slot, long PlayerId, uint? Uid, TeamSide Team,
    PlayerMatchStatistics Statistics);
public sealed class StatisticsSnapshot : ILensStateSnapshot
{
    public SnapshotSource Source { get; }
    public TeamMatchStatistics Home { get; }
    public TeamMatchStatistics Away { get; }
    public IReadOnlyList<PlayerStatisticsSnapshot> Players { get; }
    public StatisticsSnapshot(SnapshotSource source, TeamMatchStatistics home, TeamMatchStatistics away,
        IEnumerable<PlayerStatisticsSnapshot> players)
    { Source = source; Home = home; Away = away; Players = Array.AsReadOnly(players.ToArray()); }
}
public sealed record MetadataTeamSnapshot(TeamSide Side, uint? Uid, string? Name, TeamMetadataSnapshot? Details);
public sealed record MetadataPlayerSnapshot(int Slot, long PlayerId, uint? Uid, TeamSide Team,
    string? DisplayName, int? ShirtNumber, PlayerMetadataSnapshot? Details);
public sealed class MetadataSnapshot : ILensStateSnapshot
{
    public SnapshotSource Source { get; }
    public MatchMetadataSnapshot? Match { get; }
    public MetadataTeamSnapshot Home { get; }
    public MetadataTeamSnapshot Away { get; }
    public IReadOnlyList<MetadataPlayerSnapshot> Players { get; }
    public MetadataSnapshot(SnapshotSource source, MatchMetadataSnapshot? match, MetadataTeamSnapshot home,
        MetadataTeamSnapshot away, IEnumerable<MetadataPlayerSnapshot> players)
    { Source = source; Match = match; Home = home; Away = away; Players = Array.AsReadOnly(players.ToArray()); }
}
public sealed class MomentumSnapshot : ILensStateSnapshot
{
    public SnapshotSource Source { get; }
    public IReadOnlyList<MomentumPoint> Momentum { get; }
    public IReadOnlyList<MomentumPoint> RollingMomentum { get; }
    public MomentumSnapshot(SnapshotSource source, IEnumerable<MomentumPoint> momentum, IEnumerable<MomentumPoint> rollingMomentum)
    { Source = source; Momentum = Array.AsReadOnly(momentum.ToArray()); RollingMomentum = Array.AsReadOnly(rollingMomentum.ToArray()); }
}
public enum EventNotificationKind { Upsert, RemovedFromScope }
/// <summary>Future-only notification; Event is present for Upsert, absent for RemovedFromScope. Identity is SessionId/SequenceIndex.</summary>
public sealed record MatchEventNotification(string SessionId, long Sequence, int SequenceIndex, int Revision,
    EventNotificationKind Kind, MatchEvent? Event);
