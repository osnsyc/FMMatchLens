namespace FMMatchLens.Plugin.Memory;

// Managed values only. Missing optional observations never count as identity changes.
internal sealed record MatchInstanceIdentity(
    uint? HomeUid, uint? AwayUid, uint? HomeManager, uint? AwayManager,
    string? HomeFirstPlayer, string? AwayFirstPlayer,
    uint? HomeFirstPlayerUid = null, uint? AwayFirstPlayerUid = null)
{
    public bool HasTeams => HomeUid is > 0 && AwayUid is > 0 && HomeUid != AwayUid;

    public bool DiffersFrom(MatchInstanceIdentity other)
    {
        if (Changed(HomeUid, other.HomeUid) || Changed(AwayUid, other.AwayUid)) return true;
        var homePlayer = Changed(HomeFirstPlayerUid, other.HomeFirstPlayerUid) || Changed(HomeFirstPlayer, other.HomeFirstPlayer);
        var awayPlayer = Changed(AwayFirstPlayerUid, other.AwayFirstPlayerUid) || Changed(AwayFirstPlayer, other.AwayFirstPlayer);
        var manager = Changed(HomeManager, other.HomeManager) || Changed(AwayManager, other.AwayManager);
        // A goalkeeper substitution or manager change alone is not a new match.
        return homePlayer && awayPlayer || manager && (homePlayer || awayPlayer);
    }

    private static bool Changed(uint? a, uint? b) => a.HasValue && b.HasValue && a != b;
    private static bool Changed(string? a, string? b) => a is not null && b is not null && a != b;
}
