namespace FMMatchLens.Plugin.Memory;

/// <summary>A stack-backed slot-to-UID map, valid for one completed player capture.</summary>
internal readonly ref struct FramePlayerIdentityCache
{
    private readonly Span<long> _ids;
    private readonly int _homeCount;
    private readonly int _awayCount;

    public FramePlayerIdentityCache(Span<long> ids, int homeCount, int awayCount)
    {
        _ids = ids;
        _ids.Clear();
        _homeCount = homeCount;
        _awayCount = awayCount;
    }

    public void Remember(int globalSlot, long playerId)
    {
        // Negative synthetic IDs are useful for animation but are not database
        // identities. Event resolution must retain its original UID fallback.
        if ((uint)globalSlot < (uint)_ids.Length && playerId is > 0 and <= uint.MaxValue)
            _ids[globalSlot] = playerId;
    }

    public bool TryGet(bool home, int teamSlot, out long playerId)
    {
        playerId = 0;
        if (teamSlot < 0 || teamSlot >= (home ? _homeCount : _awayCount)) return false;
        var index = home ? teamSlot : _homeCount + teamSlot;
        if ((uint)index >= (uint)_ids.Length) return false;
        playerId = _ids[index];
        return playerId > 0;
    }
}
