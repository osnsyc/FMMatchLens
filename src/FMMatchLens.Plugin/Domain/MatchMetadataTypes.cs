namespace FMMatchLens.Plugin.Domain;

internal enum TeamSide
{
    Home,
    Away
}

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
    int? YouthGoals = null);

internal sealed record PlayerAttributes(
    IReadOnlyDictionary<string, int> Technical,
    IReadOnlyDictionary<string, int> Mental,
    IReadOnlyDictionary<string, int> Physical,
    IReadOnlyDictionary<string, int> Goalkeeping);
