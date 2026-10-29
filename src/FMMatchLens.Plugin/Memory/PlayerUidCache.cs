
namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Bounded per-thread identity cache. Native objects and Person pointers are
/// checked each frame; successful UID reads are refreshed on a fixed deadline.
/// </summary>
internal sealed class PlayerUidCache
{
    private readonly int _slots;
    private readonly long _refreshInterval;
    private readonly ThreadLocal<ThreadState> _threads;
    private long _generation;

    public PlayerUidCache(int slots, long refreshInterval, int matchCapacity = 8)
    {
        if (slots <= 0) throw new ArgumentOutOfRangeException(nameof(slots));
        if (refreshInterval <= 0) throw new ArgumentOutOfRangeException(nameof(refreshInterval));
        if (matchCapacity <= 0) throw new ArgumentOutOfRangeException(nameof(matchCapacity));
        _slots = slots;
        _refreshInterval = refreshInterval;
        _threads = new ThreadLocal<ThreadState>(() => new ThreadState(matchCapacity));
    }

    public void Invalidate() => Interlocked.Increment(ref _generation);

    public Capture Begin(nint match, nint homeTeam, nint awayTeam, int tick, long timestamp)
    {
        if (match == default) return default;
        var thread = _threads.Value!;
        var generation = Volatile.Read(ref _generation);
        if (thread.Generation != generation)
        {
            foreach (var candidate in thread.Matches)
            {
                if (candidate is null) continue;
                candidate.Reset(default, default, default, 0);
            }
            thread.Generation = generation;
        }

        MatchState? state = thread.Matches[thread.Recent];
        if (state?.Match != match)
        {
            state = null;
            for (var i = 0; i < thread.Matches.Length; i++)
            {
                if (thread.Matches[i]?.Match != match) continue;
                state = thread.Matches[i];
                thread.Recent = i;
                break;
            }
        }
        if (state is null)
        {
            var index = thread.Next;
            state = thread.Matches[index] ??= new MatchState(_slots);
            state.Reset(match, homeTeam, awayTeam, tick);
            thread.Recent = index;
            thread.Next = (index + 1) % thread.Matches.Length;
        }
        else if (state.HomeTeam != homeTeam || state.AwayTeam != awayTeam || tick < state.Tick)
        {
            state.Reset(match, homeTeam, awayTeam, tick);
        }
        state.Tick = tick;
        // A reentrant capture may use the same state. Its parent may no longer
        // read or overwrite entries after it returns.
        var version = ++state.Version;
        return new Capture(this, state, generation, version, timestamp);
    }

    private sealed class ThreadState
    {
        public readonly MatchState?[] Matches;
        public long Generation;
        public int Recent;
        public int Next;
        public ThreadState(int capacity) => Matches = new MatchState?[capacity];
    }

    internal sealed class MatchState
    {
        public readonly Entry[] Entries;
        public nint Match, HomeTeam, AwayTeam;
        public int Tick;
        public long Version;
        public MatchState(int slots) => Entries = new Entry[slots];
        public void Reset(nint match, nint homeTeam, nint awayTeam, int tick)
        {
            Match = match; HomeTeam = homeTeam; AwayTeam = awayTeam; Tick = tick;
            Version++;
            Array.Clear(Entries, 0, Entries.Length);
        }
    }

    internal readonly record struct Entry(nint Player, nint Person, uint Uid, long Timestamp);

    internal readonly struct Capture
    {
        private readonly PlayerUidCache? _owner;
        private readonly MatchState? _state;
        private readonly long _generation, _version, _timestamp;
        internal Capture(PlayerUidCache owner, MatchState state, long generation, long version, long timestamp)
        {
            _owner = owner; _state = state; _generation = generation; _version = version; _timestamp = timestamp;
        }
        private bool Current => _state is not null && _state.Version == _version &&
                                Volatile.Read(ref _owner!._generation) == _generation;

        public bool TryGet(int slot, nint player, nint person, out uint uid)
        {
            uid = 0;
            if (Current && (uint)slot < (uint)_state!.Entries.Length && player != default && person != default)
            {
                var entry = _state.Entries[slot];
                if (entry.Uid != 0 && entry.Player == player && entry.Person == person)
                {
                    var age = _timestamp - entry.Timestamp;
                    if (age >= 0 && age < _owner!._refreshInterval)
                    {
                        uid = entry.Uid;
                        return true;
                    }
                }
            }
            return false;
        }

        public void Store(int slot, nint player, nint person, uint uid)
        {
            if (!Current || (uint)slot >= (uint)_state!.Entries.Length || player == default || person == default || uid == 0) return;
            // Timestamp belongs to the capture that read the native UID, never
            // to a later cache hit.
            _state.Entries[slot] = new Entry(player, person, uid, _timestamp);
        }

        public void Forget(int slot)
        {
            if (Current && (uint)slot < (uint)_state!.Entries.Length) _state.Entries[slot] = default;
        }
    }
}
