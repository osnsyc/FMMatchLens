using System.Globalization;
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
    int BallXCentimeters,
    int BallYCentimeters,
    int BallZCentimeters,
    float HalfPitchWidth,
    float HalfPitchLength,
    IReadOnlyList<NativeMomentumEventData> MomentumEvents,
    IReadOnlyList<MomentumTickData> Momentum,
    IReadOnlyList<MomentumTickData> RollingMomentum,
    TeamTickData Home,
    TeamTickData Away,
    IReadOnlyList<PlayerTickData> Players,
    IReadOnlyList<MomentumEventUpdate>? MomentumEventUpdates = null)
{
    [JsonPropertyName("ratingModel")]
    public RatingResearchMatchData? RatingResearch { get; init; }

    public RealtimeTickFrame ToWireFrame(RealtimeTickFrame? previous = null)
    {
        var previousBySlot = previous?.Players.ToDictionary(player => player.Slot);
        var players = Players.Select(player =>
        {
            RatingResearchPlayerData? priorResearch = null;
            if (previousBySlot is not null && previousBySlot.TryGetValue(player.Slot, out var prior))
            {
                priorResearch = prior.RatingResearch;
            }
            var ratingInputs = player.RatingResearch is null
                ? null
                : RatingResearchPlayerWireData.From(player.RatingResearch, priorResearch);
            return player with { RatingInputs = ratingInputs };
        }).ToArray();
        return this with { Players = players };
    }
}

internal sealed record RatingResearchMatchData(
    uint RatingBaseCondition,
    byte MatchPhase,
    byte EventRewardBranch,
    int ActiveBaseline,
    float HomeBackgroundInput,
    float AwayBackgroundInput);

internal sealed record RatingModelMetadata(
    int ActiveBaseline,
    float HomeBackgroundInput,
    float AwayBackgroundInput);

internal sealed record RatingResearchPlayerData(
    RatingStatsInputs Stats,
    int InternalW25,
    int InternalW24,
    sbyte SpecialW2C,
    sbyte SpecialW2D,
    sbyte SpecialW2E,
    byte SpecialW2F,
    byte SpecialW30,
    byte SpecialW31,
    int RawInternalRating,
    ulong InPossessionRoleDuty,
    ulong OutOfPossessionRoleDuty,
    sbyte SpecialConditionA,
    sbyte SpecialConditionB,
    byte TeamAEventCounterCandidate,
    byte TeamBEventCounterCandidate,
    byte TeamAEventAdjustmentCandidate,
    byte TeamBEventAdjustmentCandidate,
    int TotalEligibleDuration,
    IReadOnlyList<byte[]> RatingEventsRaw);

internal sealed record RatingResearchPlayerWireData(
    byte[] StatsPacked,
    int InternalW25,
    int InternalW24,
    sbyte SpecialW2C,
    sbyte SpecialW2D,
    sbyte SpecialW2E,
    byte SpecialW2F,
    byte SpecialW30,
    byte SpecialW31,
    int RawInternalRating,
    string InPossessionRoleDuty,
    string OutOfPossessionRoleDuty,
    sbyte SpecialConditionA,
    sbyte SpecialConditionB,
    int TotalEligibleDuration,
    int RatingEventsCommonLength,
    IReadOnlyList<byte[]> RatingEventsTail)
{
    internal static RatingResearchPlayerWireData From(
        RatingResearchPlayerData value,
        RatingResearchPlayerData? previous = null)
    {
        var common = CommonRawRecordLength(previous?.RatingEventsRaw, value.RatingEventsRaw);
        return new(
        PackStats(value.Stats), value.InternalW25, value.InternalW24,
        value.SpecialW2C, value.SpecialW2D, value.SpecialW2E,
        value.SpecialW2F, value.SpecialW30, value.SpecialW31,
        value.RawInternalRating,
        value.InPossessionRoleDuty.ToString(CultureInfo.InvariantCulture),
        value.OutOfPossessionRoleDuty.ToString(CultureInfo.InvariantCulture),
        value.SpecialConditionA, value.SpecialConditionB,
        value.TotalEligibleDuration, common, value.RatingEventsRaw.Skip(common).ToArray());
    }

    internal static byte[] PackStats(RatingStatsInputs value)
    {
        using var stream = new MemoryStream(36);
        using var writer = new BinaryWriter(stream);
        writer.Write(value.OpenPlayXa);
        writer.Write(value.PenaltyAttempts);
        writer.Write(value.DefensiveBlocksCandidate); writer.Write(value.PenaltiesFaced); writer.Write(value.PenaltiesSaved);
        writer.Write(value.ChancesCreated); writer.Write(value.YellowCards); writer.Write(value.RedCards);
        writer.Write(value.OpenPlayKeyPasses);
        writer.Write(value.ErrorsLeadingToShotOrGoalCandidate); writer.Write(value.TeamGoalsWhileOnPitchCandidate);
        writer.Write(value.TeamConcededWhileOnPitchCandidate); writer.Write(value.PossessionWonCandidate);
        writer.Write(value.CrossAttemptsTypeOne); writer.Write(value.CrossAttemptsTypeTwo);
        writer.Write(value.CrossCompletionsTypeOne); writer.Write(value.CrossCompletionsTypeTwo);
        writer.Write(value.GoalsConceded); writer.Write(value.Offsides); writer.Write(value.HeadersLost);
        writer.Write(value.PossessionLost); writer.Write(value.PressesAttempted); writer.Write(value.PressesWon);
        writer.Write(value.ShortPassesAttemptedCandidate); writer.Write(value.LongPassesAttemptedCandidate);
        writer.Write(value.ShortPassesCompletedCandidate); writer.Write(value.LongPassesCompletedCandidate);
        writer.Write(value.ShotsOutsideBox); writer.Write(value.Sprints);
        var packed = stream.ToArray();
        if (packed.Length != 36) throw new InvalidOperationException("Rating-only stats wire size changed unexpectedly.");
        return packed;
    }

    private static int CommonRawRecordLength(
        IReadOnlyList<byte[]>? previous,
        IReadOnlyList<byte[]> current)
    {
        if (previous is null) return 0;
        var limit = Math.Min(previous.Count, current.Count);
        var common = 0;
        while (common < limit && previous[common].AsSpan().SequenceEqual(current[common])) common++;
        return common;
    }
}

internal readonly record struct RatingStatsInputs(
    float ExpectedGoals,
    float OpenPlayXa,
    byte Goals,
    byte PenaltyAttempts,
    byte Penalties,
    byte OwnGoals,
    byte Shots,
    byte ShotsOnTarget,
    byte SavesHeld,
    byte SavesParried,
    byte SavesTipped,
    byte DefensiveBlocksCandidate,
    byte PenaltiesFaced,
    byte PenaltiesSaved,
    byte Assists,
    byte ChancesCreated,
    byte Dribbles,
    byte Fouls,
    byte Fouled,
    byte YellowCards,
    byte RedCards,
    byte OpenPlayKeyPasses,
    byte TacklesAttempted,
    byte TacklesWon,
    byte AerialsAttempted,
    byte AerialsWon,
    byte Interceptions,
    byte ErrorsLeadingToShotOrGoalCandidate,
    byte TeamGoalsWhileOnPitchCandidate,
    byte TeamConcededWhileOnPitchCandidate,
    byte PossessionWonCandidate,
    byte Clearances,
    byte CrossAttemptsTypeOne,
    byte CrossAttemptsTypeTwo,
    byte CrossCompletionsTypeOne,
    byte CrossCompletionsTypeTwo,
    byte GoalsConceded,
    byte Offsides,
    byte HeadersLost,
    byte PossessionLost,
    byte PressesAttempted,
    byte PressesWon,
    short ShortPassesAttemptedCandidate,
    short LongPassesAttemptedCandidate,
    short ShortPassesCompletedCandidate,
    short LongPassesCompletedCandidate,
    byte ShotsOutsideBox,
    byte Sprints);

internal enum MomentumEventUpdateKind
{
    Add,
    Update,
}

internal readonly record struct MomentumEventUpdate(
    long UpdateSequence,
    MomentumEventUpdateKind Operation,
    int SequenceIndex,
    int Revision,
    NativeMomentumEventData Event);

internal readonly record struct LogicalMomentumEvent(
    int SequenceIndex,
    int Revision,
    int FirstSeenFrameTick,
    int LastUpdatedFrameTick,
    NativeMomentumEventData Event);

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
    int RedCards,
    int FirstHalfShots,
    int SecondHalfShots);

internal readonly record struct PlayerTickData(
    int Slot,
    // Kept as PlayerId in the API/archive schema for compatibility. Its value is
    // the FM database Person.Uid; a negative slot-derived value means UID unreadable.
    long PlayerId,
    TeamSide Team,
    bool IsBallHolder,
    float X,
    float Y,
    ushort SpeedCentimetersPerSecond,
    ushort? AngleDegrees,
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
    int ProgressivePasses,
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
    int SavesHeld,
    int SavesParried,
    int SavesTipped,
    float DistanceM)
{
    [JsonIgnore]
    public RatingResearchPlayerData? RatingResearch { get; init; }

    [JsonPropertyName("ratingInputs")]
    public RatingResearchPlayerWireData? RatingInputs { get; init; }
}

internal sealed record RealtimeMatchMetadata(
    string MatchId,
    long StartedUnixMilliseconds,
    int CapturedTick,
    RealtimeTeamMetadata Home,
    RealtimeTeamMetadata Away,
    IReadOnlyList<RealtimePlayerMetadata> Players,
    string? MatchDate = null,
    float? HalfPitchWidth = null,
    float? HalfPitchLength = null,
    RealtimeCompetitionMetadata? Competition = null);

internal readonly record struct RealtimeCompetitionMetadata(
    uint? Uid,
    string? Name,
    string? LogoPath,
    uint? PrimaryColour,
    uint? SecondaryColour,
    uint? TertiaryColour);

internal readonly record struct RealtimeTeamMetadata(
    uint? Uid,
    uint? ClubUid,
    string Name,
    uint? BackgroundColour,
    uint? ForegroundColour,
    uint? OutlineColour,
    string? LogoPath,
    RealtimeManagerMetadata? Manager = null,
    uint? ShirtNumberColor = null,
    uint? ShirtBackgroundColor = null,
    uint? ShirtBackgroundColorGK = null);

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
    IReadOnlyDictionary<string, int>? PositionFamiliarities = null,
    string? ShirtName = null,
    int? SquadNumber = null);

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
