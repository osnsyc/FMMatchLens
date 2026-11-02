namespace FMMatchLens.Contracts;

[Flags]
public enum LensCapabilities : ulong
{
    None = 0,
    MatchSnapshot = 1UL << 0,
    PlayerPositions = 1UL << 1,
    BallPosition = 1UL << 2,
    MatchEvents = 1UL << 3,
    MomentumSummary = 1UL << 4,
    RawMomentumEvents = 1UL << 5,
    RawTickStream = 1UL << 6,
    DetailedMatchStatistics = 1UL << 7,
    PlayerMovement = 1UL << 8,
    PlayerProfiles = 1UL << 9,
    PlayerAttributes = 1UL << 10,
    TacticalAssignments = 1UL << 11,
    SeasonStatistics = 1UL << 12,
    MatchMetadata = 1UL << 13,
}

public enum LensState { Unavailable, Waiting, Active, Ending, Lost }
public enum TeamSide { Home, Away }
public enum EventOperation { Add, Update }
public sealed record LensStatus(LensState State, string? SessionId, string Reason);

/// <summary>Metres from pitch centre: X lateral, Y longitudinal, Z height. No display rotation.</summary>
public readonly record struct Position3(float X, float Y, float Z = 0);

public sealed record TeamSnapshot(TeamSide Side, uint? Uid, string? Name,
    int Goals, float Xg, int Shots, int ShotsOnTarget, int Passes, int PassesCompleted)
{
    public TeamMatchStatistics? Statistics { get; init; }
    public TeamMetadataSnapshot? Metadata { get; init; }
}

/// <summary>PlayerId is the existing UID alias; negative -(Slot+1) is session-local only.</summary>
public sealed record PlayerSnapshot(int Slot, long PlayerId, uint? Uid, TeamSide Team,
    string? DisplayName, int? ShirtNumber, bool IsOnPitch, bool IsBallHolder,
    Position3? Position, float Rating, int Goals, int Assists, int Passes, int PassesCompleted)
{
    public PlayerMovementSnapshot? Movement { get; init; }
    public PlayerMatchStatistics? Statistics { get; init; }
    public PlayerMetadataSnapshot? Metadata { get; init; }
}

public readonly record struct MomentumPoint(float Value, int TimeTicks, int HomeWeight, int AwayWeight);

/// <summary>A complete immutable projection. Timestamp is managed frame construction time, not native capture time.</summary>
public sealed class MatchSnapshot
{
    public MatchMetadataSnapshot? Metadata { get; init; }
    public string SessionId { get; }
    public string MatchId { get; }
    public long Sequence { get; }
    public int Tick { get; }
    public int DisplayTick { get; }
    public int Period { get; }
    public DateTimeOffset CapturedAtUtc { get; }
    public TeamSnapshot Home { get; }
    public TeamSnapshot Away { get; }
    public TeamSide? PossessionTeam { get; }
    public long? BallHolderPlayerId { get; }
    public Position3? BallPosition { get; }
    public float? HalfPitchWidth { get; }
    public float? HalfPitchLength { get; }
    public IReadOnlyList<PlayerSnapshot> Players { get; }
    public IReadOnlyList<MomentumPoint> Momentum { get; }
    public IReadOnlyList<MomentumPoint> RollingMomentum { get; }

    public MatchSnapshot(string sessionId, string matchId, long sequence, int tick, int displayTick,
        int period, DateTimeOffset capturedAtUtc, TeamSnapshot home, TeamSnapshot away,
        TeamSide? possessionTeam, long? ballHolderPlayerId, Position3? ballPosition,
        float? halfPitchWidth, float? halfPitchLength, IEnumerable<PlayerSnapshot> players,
        IEnumerable<MomentumPoint> momentum, IEnumerable<MomentumPoint> rollingMomentum)
    {
        SessionId = sessionId; MatchId = matchId; Sequence = sequence; Tick = tick;
        DisplayTick = displayTick; Period = period; CapturedAtUtc = capturedAtUtc;
        Home = home; Away = away; PossessionTeam = possessionTeam;
        BallHolderPlayerId = ballHolderPlayerId; BallPosition = ballPosition;
        HalfPitchWidth = halfPitchWidth; HalfPitchLength = halfPitchLength;
        Players = Array.AsReadOnly(players.ToArray());
        Momentum = Array.AsReadOnly(momentum.ToArray());
        RollingMomentum = Array.AsReadOnly(rollingMomentum.ToArray());
    }
}

/// <summary>Observed logical event upsert, not a lossless raw native event feed.
/// Identity is (SessionId, SequenceIndex). Unknown EventType/Flags must be tolerated.</summary>
public sealed record MatchEvent(string SessionId, long Sequence, int SequenceIndex, int Revision,
    EventOperation Operation, int Tick, int CompletionTick, TeamSide Team,
    int PlayerSlot, long? PlayerId, int ReceiverPlayerSlot, long? ReceiverPlayerId,
    int EventType, int Flags, Position3? Position)
{
    /// <summary>Captured output-record points only; not a complete high-frequency trajectory stream.</summary>
    public EventTrajectorySnapshot? Trajectory { get; init; }
}

public sealed record MatchLifecycleEvent(long Sequence, string? SessionId, LensState PreviousState,
    LensState State, string Reason);

public sealed record SubscriptionDiagnostics(int Pending, long Dropped, long LastSequence,
    long CallbackErrors, string? DisabledReason)
{
    public long Coalesced { get; init; }
    public long Suppressed { get; init; }
    public string? LastSessionId { get; init; }
}
