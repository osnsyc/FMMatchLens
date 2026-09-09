using System.Text.Json.Serialization;

namespace FMMatchLens.Plugin.Domain;

/// <summary>
/// Pointer-free data captured for one animated (real-time) match tick.
/// These values are safe to retain and serialize after the native hook returns.
/// </summary>
internal sealed record RealtimeTickFrame(
    long Sequence,
    string MatchId,
    int Tick,
    int DisplayTick,
    int Period,
    long CapturedUnixMilliseconds,
    TeamSide? PossessionTeam,
    long? BallHolderPlayerId,
    float HalfPitchWidth,
    float HalfPitchLength,
    IReadOnlyList<NativeMomentumEventData> MomentumEvents,
    IReadOnlyList<MomentumTickData> Momentum,
    IReadOnlyList<MomentumTickData> RollingMomentum,
    TeamTickData Home,
    TeamTickData Away,
    IReadOnlyList<PlayerTickData> Players);

internal readonly record struct NativeMomentumEventData(
    int EventIndex,
    int Tick,
    float LateralPosition,
    float LongitudinalPosition,
    IReadOnlyList<NativeMomentumTrajectoryPoint> TrajectoryPoints,
    TeamSide Team,
    int PlayerSlot,
    long PlayerId,
    int ReceiverPlayerSlot,
    long ReceiverPlayerId,
    int EventType,
    int Flags,
    int SequenceIndex,
    int CompletionTick)
{
    // TrajectoryPoints is the authoritative representation. Keeping endpoints as
    // computed JSON properties prevents live frames and archive v3 from disagreeing.
    public float? TrajectoryStartLateralPosition =>
        TrajectoryPoints is { Count: > 0 } points ? points[0].LateralPosition : null;

    public float? TrajectoryStartLongitudinalPosition =>
        TrajectoryPoints is { Count: > 0 } points ? points[0].LongitudinalPosition : null;

    public float? TrajectoryEndLateralPosition =>
        TrajectoryPoints is { Count: > 0 } points ? points[^1].LateralPosition : null;

    public float? TrajectoryEndLongitudinalPosition =>
        TrajectoryPoints is { Count: > 0 } points ? points[^1].LongitudinalPosition : null;
}

internal readonly record struct NativeMomentumTrajectoryPoint(
    float LateralPosition,
    float LongitudinalPosition);

internal readonly record struct MomentumTickData(
    float Value,
    int TimeTicks,
    int HomeWeight,
    int AwayWeight);

internal readonly record struct TeamTickData(
    int Goals,
    float Xg,
    int PossessionTime,
    int Shots,
    int ShotsOnTarget,
    int ShotsOffTarget,
    int BlockedShots,
    int ClearCutChances,
    int Passes,
    int PassesCompleted,
    int Crosses,
    int CrossesCompleted,
    int Aerials,
    int AerialsWon,
    int ProgressivePasses,
    int FinalThirdPasses,
    int TacklesAttempted,
    int TacklesWon,
    int Fouls,
    int Corners,
    int Offsides,
    int YellowCards,
    int RedCards);

internal readonly record struct PlayerTickData(
    int Slot,
    // Kept as PlayerId in the API/archive schema for compatibility. Its value is
    // the FM database Person.Uid; a negative slot-derived value means UID unreadable.
    long PlayerId,
    TeamSide Team,
    bool IsBallHolder,
    float X,
    float Y,
    float Rating,
    bool IsSubstitute,
    bool IsOnPitch,
    int SubbedOnMinute,
    int SubbedOffMinute,
    int Penalties,
    int OwnGoals,
    int OverallPhysicalCondition,
    int MatchSharpness,
    int Goals,
    int Assists,
    float Xg,
    float Xa,
    int Shots,
    int ShotsOnTarget,
    int BlockedShots,
    int ClearCutChances,
    int HitWoodwork,
    int Dribbles,
    int Fouls,
    int Fouled,
    int Crosses,
    int CrossesCompleted,
    int Passes,
    int PassesCompleted,
    int KeyPasses,
    int TacklesAttempted,
    int TacklesWon,
    int KeyTackles,
    int Aerials,
    int AerialsWon,
    int Interceptions,
    int ThrowIns,
    int Corners,
    int DefensiveFreeKicks,
    int AttackingFreeKicks,
    int Clearances,
    int ShotsFaced,
    float DistanceM);

internal sealed record RealtimeMatchMetadata(
    string MatchId,
    long StartedUnixMilliseconds,
    int CapturedTick,
    RealtimeTeamMetadata Home,
    RealtimeTeamMetadata Away,
    IReadOnlyList<RealtimePlayerMetadata> Players,
    string? MatchDate = null);

internal readonly record struct RealtimeTeamMetadata(
    uint? Uid,
    uint? ClubUid,
    string Name,
    uint? BackgroundColour,
    uint? ForegroundColour,
    uint? OutlineColour,
    string? LogoPath,
    RealtimeManagerMetadata? Manager = null);

internal readonly record struct RealtimeManagerMetadata(
    uint? Uid,
    string? FirstName,
    string? SecondName,
    bool IsHumanControlled);

internal readonly record struct RealtimePlayerMetadata(
    int Slot,
    // Compatibility alias for Uid used by frame/event relationships.
    long PlayerId,
    uint? Uid,
    TeamSide Team,
    int? ShirtNumber,
    string? Position,
    string? FirstName,
    string? SecondName,
    string? CommonName,
    string DisplayName,
    string? PortraitPath,
    PlayerProfile? Profile,
    PlayerAttributes? Attributes,
    PlayerTacticalAssignment? InPossession,
    PlayerTacticalAssignment? OutOfPossession,
    IReadOnlyDictionary<string, int>? PositionFamiliarities = null);

internal static class PlayerPositionFamiliarity
{
    public static readonly string[] Labels =
    {
        "GK", "SW", "DL", "DC", "DR", "DM", "ML", "MC", "MR", "AML", "AMC", "AMR", "ST", "WBL", "WBR"
    };
}

internal readonly record struct PlayerTacticalAssignment(
    uint PositionMask,
    string Position,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
    ulong RoleDuty,
    string Role,
    string RoleAbbreviation,
    string? Duty);
