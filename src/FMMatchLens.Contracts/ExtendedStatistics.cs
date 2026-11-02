namespace FMMatchLens.Contracts;

/// <summary>Existing per-tick team counters; DerivedShotsOffTarget uses the captured player-shot counters.</summary>
public sealed record TeamMatchStatistics
{
    public int Goals { get; init; }
    public float Xg { get; init; }
    public int PossessionTime { get; init; }
    public int Shots { get; init; }
    public int ShotsOnTarget { get; init; }
    public int DerivedShotsOffTarget { get; init; }
    public int BlockedShots { get; init; }
    public int ClearCutChances { get; init; }
    public int Passes { get; init; }
    public int PassesCompleted { get; init; }
    public int Crosses { get; init; }
    public int CrossesCompleted { get; init; }
    public int Aerials { get; init; }
    public int AerialsWon { get; init; }
    public int ProgressivePasses { get; init; }
    public int FinalThirdPasses { get; init; }
    public int TacklesAttempted { get; init; }
    public int TacklesWon { get; init; }
    public int Fouls { get; init; }
    public int Corners { get; init; }
    public int Offsides { get; init; }
    public int YellowCards { get; init; }
    public int RedCards { get; init; }
    public int FirstHalfShots { get; init; }
    public int SecondHalfShots { get; init; }
}

/// <summary>Per-tick counters and state. Nullable rating-input counters are absent when that capture is unavailable.
/// BlockedShotsCandidate retains its unconfirmed source semantics.</summary>
public sealed record PlayerMatchStatistics
{
    public float Rating { get; init; }
    public bool IsSubstitute { get; init; }
    public int SubbedOnMinute { get; init; }
    public int SubbedOffMinute { get; init; }
    public int Penalties { get; init; }
    public int OwnGoals { get; init; }
    public int OverallPhysicalCondition { get; init; }
    public int MatchSharpness { get; init; }
    public int Goals { get; init; }
    public int Assists { get; init; }
    public float Xg { get; init; }
    public float Xa { get; init; }
    public int Shots { get; init; }
    public int ShotsOnTarget { get; init; }
    public int BlockedShotsCandidate { get; init; }
    public int ClearCutChances { get; init; }
    public int HitWoodwork { get; init; }
    public int Dribbles { get; init; }
    public int Fouls { get; init; }
    public int Fouled { get; init; }
    public int Crosses { get; init; }
    public int CrossesCompleted { get; init; }
    public int Passes { get; init; }
    public int PassesCompleted { get; init; }
    public int ProgressivePasses { get; init; }
    public int KeyPasses { get; init; }
    public int TacklesAttempted { get; init; }
    public int TacklesWon { get; init; }
    public int KeyTackles { get; init; }
    public int Aerials { get; init; }
    public int AerialsWon { get; init; }
    public int Interceptions { get; init; }
    public int ThrowIns { get; init; }
    public int Corners { get; init; }
    public int DefensiveFreeKicks { get; init; }
    public int AttackingFreeKicks { get; init; }
    public int Clearances { get; init; }
    public int ShotsFaced { get; init; }
    public int SavesHeld { get; init; }
    public int SavesParried { get; init; }
    public int SavesTipped { get; init; }
    public float DistanceMeters { get; init; }
    public float? OpenPlayXa { get; init; }
    public int? PenaltyAttempts { get; init; }
    public int? GoalsConceded { get; init; }
    public int? PenaltiesFaced { get; init; }
    public int? PenaltiesSaved { get; init; }
    public int? ChancesCreated { get; init; }
    public int? YellowCards { get; init; }
    public int? RedCards { get; init; }
    public int? OpenPlayKeyPasses { get; init; }
    public int? Offsides { get; init; }
    public int? HeadersLost { get; init; }
    public int? PossessionLost { get; init; }
    public int? PressesAttempted { get; init; }
    public int? PressesWon { get; init; }
    public int? ShotsOutsideBox { get; init; }
    public int? Sprints { get; init; }
}

/// <summary>Captured profile values; Condition/MatchSharpness are raw metadata scales, distinct from per-tick byte values.</summary>
public sealed record PlayerProfileSnapshot
{
    public int? WeeklyWage { get; init; }
    public int? HeightCm { get; init; }
    public int? Condition { get; init; }
    public int? Morale { get; init; }
    public int? CurrentAbility { get; init; }
    public int? PotentialAbility { get; init; }
    public int? CurrentReputation { get; init; }
    public string? DateOfBirth { get; init; }
    public uint? NationUid { get; init; }
    public int? BodyType { get; init; }
    public uint? GuideValueGbp { get; init; }
    public int? InternationalApps { get; init; }
    public int? InternationalGoals { get; init; }
    public int? YouthApps { get; init; }
    public int? YouthGoals { get; init; }
    public int? MatchSharpness { get; init; }
    public SeasonStatisticsSnapshot? SeasonStats { get; init; }
}

/// <summary>Observed FM27 season-slot layout; category labels/counters still require independent game-UI verification.</summary>
public sealed record SeasonStatisticsSnapshot
{
    public bool RequiresGameUiValidation => true;
    public SeasonStatisticsCategory? Friendly { get; init; }
    public SeasonStatisticsCategory? League { get; init; }
    public SeasonStatisticsCategory? Cup { get; init; }
    public SeasonStatisticsCategory? OtherCompetition { get; init; }
    public SeasonStatisticsCategory? International { get; init; }
    public SeasonStatisticsCategory? ClubTotal { get; init; }
    public SeasonStatisticsCategory? Unknown { get; init; }
    public SeasonStatisticsCategory? InternationalTotal { get; init; }
}

public sealed record SeasonStatisticsCategory
{
    public int? RatingSumTimes10 { get; init; }
    public int? Minutes { get; init; }
    public int? Starts { get; init; }
    public int? SubstituteAppearances { get; init; }
    public int? Appearances { get; init; }
    public int? Goals { get; init; }
    public int? Assists { get; init; }
    public int? GoalsConceded { get; init; }
    public int? PenaltyAttempts { get; init; }
    public int? PenaltiesScored { get; init; }
    public int? PlayerOfMatchAwards { get; init; }
    public int? RedCards { get; init; }
    public int? YellowCards { get; init; }
    public int? CleanSheets { get; init; }
    public SeasonStatisticsDetails? Detailed { get; init; }
}

public sealed record SeasonStatisticsDetails
{
    public int? TeamGoals { get; init; }
    public int? TeamGoalsConceded { get; init; }
    public int? Wins { get; init; }
    public int? Losses { get; init; }
    public int? PassesAttempted { get; init; }
    public int? PassesCompleted { get; init; }
    public int? TacklesAttempted { get; init; }
    public int? TacklesWon { get; init; }
    public int? HeadersAttempted { get; init; }
    public int? HeadersWon { get; init; }
    public int? Dribbles { get; init; }
    public int? Fouls { get; init; }
    public int? Fouled { get; init; }
    public int? Shots { get; init; }
    public int? ShotsOnTarget { get; init; }
    public int? ErrorsLeadingToGoal { get; init; }
    public int? DistanceKmTimes10 { get; init; }
    public int? Offsides { get; init; }
    public int? KeyPasses { get; init; }
    public int? KeyTackles { get; init; }
    public int? Interceptions { get; init; }
    public int? ChancesCreated { get; init; }
    public int? Blocks { get; init; }
    public int? PossessionLost { get; init; }
    public int? PossessionWon { get; init; }
    public int? ExpectedGoalsTimes100 { get; init; }
    public int? ExpectedAssistsTimes100 { get; init; }
    public int? Clearances { get; init; }
    public int? GoalsOutsideBox { get; init; }
    public int? OpenPlayCrossesAttempted { get; init; }
    public int? ShotsOutsideBox { get; init; }
    public int? GoalsPreventedTimes100 { get; init; }
    public int? Sprints { get; init; }
    public int? ProgressivePasses { get; init; }
    public int? PressesAttempted { get; init; }
    public int? PressesWon { get; init; }
    public int? OpenPlayKeyPasses { get; init; }
    public int? NonPenaltyExpectedGoalsTimes100 { get; init; }
    public int? CrossesAttempted { get; init; }
    public int? CrossesCompleted { get; init; }
    public int? HeadersLost { get; init; }
    public float? DistanceKilometers => DistanceKmTimes10 / 10f;
    public float? ExpectedGoals => ExpectedGoalsTimes100 / 100f;
    public float? ExpectedAssists => ExpectedAssistsTimes100 / 100f;
    public float? NonPenaltyExpectedGoals => NonPenaltyExpectedGoalsTimes100 / 100f;
    public float? GoalsPrevented => GoalsPreventedTimes100 / 100f;
}
