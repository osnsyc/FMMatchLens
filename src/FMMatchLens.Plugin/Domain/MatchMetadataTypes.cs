namespace FMMatchLens.Plugin.Domain;

internal enum TeamSide
{
    Home,
    Away
}

internal sealed record PlayerSeasonStats(
    PlayerSeasonStatsSlot? Friendly,
    PlayerSeasonStatsSlot? League,
    PlayerSeasonStatsSlot? Cup,
    PlayerSeasonStatsSlot? OtherCompetition,
    PlayerSeasonStatsSlot? International,
    PlayerSeasonStatsSlot? ClubTotal,
    PlayerSeasonStatsSlot? Unknown,
    PlayerSeasonStatsSlot? InternationalTotal);

internal sealed record PlayerSeasonStatsSlot(
    int? RatingSumTimes10,
    int? Minutes,
    int? Starts,
    int? SubstituteAppearances,
    int? Appearances,
    int? Goals,
    int? Assists,
    int? GoalsConceded,
    int? PenaltyAttempts,
    int? PenaltiesScored,
    int? PlayerOfMatchAwards,
    int? RedCards,
    int? YellowCards,
    int? CleanSheets,
    PlayerSeasonDetailedStats? Detailed);

internal sealed record PlayerSeasonDetailedStats(
    int? TeamGoals,
    int? TeamGoalsConceded,
    int? Wins,
    int? Losses,
    int? PassesAttempted,
    int? PassesCompleted,
    int? TacklesAttempted,
    int? TacklesWon,
    int? HeadersAttempted,
    int? HeadersWon,
    int? Dribbles,
    int? Fouls,
    int? Fouled,
    int? Shots,
    int? ShotsOnTarget,
    int? ErrorsLeadingToGoal,
    int? DistanceKmTimes10,
    int? Offsides,
    int? OpenPlayCrossesCompleted,
    int? KeyPasses,
    int? KeyTackles,
    int? Interceptions,
    int? ChancesCreated,
    int? Blocks,
    int? PossessionLost,
    int? PossessionWon,
    int? ExpectedGoalsTimes100,
    int? ExpectedAssistsTimes100,
    int? Clearances,
    int? GoalsOutsideBox,
    int? OpenPlayCrossesAttempted,
    int? ShotsOutsideBox,
    int? GoalsPreventedTimes100,
    int? Sprints,
    int? ProgressivePasses,
    int? PressesAttempted,
    int? PressesWon,
    int? OpenPlayKeyPasses,
    int? NonPenaltyExpectedGoalsTimes100,
    int? CrossesAttempted,
    int? CrossesCompleted,
    int? HeadersLost);

internal sealed record PlayerProfile(
    int? WeeklyWage,
    int? HeightCm,
    int? Condition,
    int? Morale,
    int? CurrentAbility,
    int? PotentialAbility,
    int? CurrentReputation,
    string? DateOfBirth = null,
    uint? NationUid = null,
    int? BodyType = null,
    uint? GuideValueGbp = null,
    int? InternationalApps = null,
    int? InternationalGoals = null,
    int? YouthApps = null,
    int? YouthGoals = null,
    int? MatchSharpness = null,
    PlayerSeasonStats? SeasonStats = null);

internal sealed record PlayerAttributes(
    IReadOnlyDictionary<string, int> Technical,
    IReadOnlyDictionary<string, int> Mental,
    IReadOnlyDictionary<string, int> Physical,
    IReadOnlyDictionary<string, int> Goalkeeping,
    string? Traits);
