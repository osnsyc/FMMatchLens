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
    int? CurrentReputation);

internal sealed record PlayerAttributes(
    IReadOnlyDictionary<string, int> Technical,
    IReadOnlyDictionary<string, int> Mental,
    IReadOnlyDictionary<string, int> Physical,
    IReadOnlyDictionary<string, int> Goalkeeping);
