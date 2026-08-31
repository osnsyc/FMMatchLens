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
    int? BallHolderPlayerId,
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
    TeamSide Team,
    int PlayerSlot,
    int PlayerId,
    int ReceiverPlayerSlot,
    int ReceiverPlayerId,
    int EventType,
    int Flags);

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
    int PlayerId,
    TeamSide Team,
    bool IsBallHolder,
    float X,
    float Y,
    float Rating,
    bool IsSubstitute,
    bool IsOnPitch,
    int SubbedOnMinute,
    int SubbedOffMinute,
    int YellowCards,
    int RedCards,
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
    IReadOnlyList<RealtimePlayerMetadata> Players);

internal readonly record struct RealtimeTeamMetadata(
    uint? Uid,
    uint? ClubUid,
    string Name,
    uint? BackgroundColour,
    uint? ForegroundColour,
    uint? OutlineColour,
    string? LogoPath);

internal readonly record struct RealtimePlayerMetadata(
    int Slot,
    int PlayerId,
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
    PlayerTacticalAssignment? OutOfPossession);

internal readonly record struct PlayerTacticalAssignment(
    uint PositionMask,
    string Position,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
    ulong RoleDuty,
    string Role,
    string RoleAbbreviation,
    string? Duty);
