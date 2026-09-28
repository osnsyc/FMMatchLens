using FMMatchLens.Plugin.Domain;

namespace FMMatchLens.Plugin.Services;

/// <summary>
/// Converts mutable native-vector observations into stable logical event upserts.
/// EventIndex is deliberately treated as debug location, never as identity.
/// </summary>
internal sealed class MomentumEventReconciler
{
    private readonly Dictionary<int, LogicalState> _eventsBySequence = new();
    private readonly List<MomentumEventUpdate> _updates = new();
    private readonly Action<string>? _reportCollision;
    private long _nextUpdateSequence = 1;

    public MomentumEventReconciler(Action<string>? reportCollision = null)
    {
        _reportCollision = reportCollision;
    }

    public long RelocationCount { get; private set; }
    public long SemanticRevisionCount { get; private set; }
    public long SequenceCollisionCount { get; private set; }
    public long LatestUpdateSequence => _nextUpdateSequence - 1;

    public IReadOnlyList<MomentumEventUpdate> Apply(
        int frameTick,
        IReadOnlyList<NativeMomentumEventData> observations)
    {
        if (observations.Count == 0) return Array.Empty<MomentumEventUpdate>();

        var emitted = new List<MomentumEventUpdate>();
        foreach (var current in observations)
        {
            var sequenceIndex = current.SequenceIndex;
            if (!_eventsBySequence.TryGetValue(sequenceIndex, out var previous))
            {
                var state = new LogicalState(current, 0, frameTick, frameTick);
                _eventsBySequence.Add(sequenceIndex, state);
                Emit(MomentumEventUpdateKind.Add, state, emitted);
                continue;
            }

            if (!IsPlausibleSameLogicalEvent(previous.Event, current))
            {
                SequenceCollisionCount++;
                _reportCollision?.Invoke(
                    $"Momentum SequenceIndex collision seq={sequenceIndex}: " +
                    $"existing(index={previous.Event.EventIndex},tick={previous.Event.Tick},team={previous.Event.Team},slot={previous.Event.PlayerSlot}) " +
                    $"incoming(index={current.EventIndex},tick={current.Tick},team={current.Team},slot={current.PlayerSlot}).");
                continue;
            }

            if (SameSemanticContent(previous.Event, current))
            {
                if (previous.Event.EventIndex != current.EventIndex)
                {
                    RelocationCount++;
                    previous.PreviousEventIndexes.Add(previous.Event.EventIndex);
                }
                previous.Event = current;
                continue;
            }

            if (previous.Event.EventIndex != current.EventIndex)
            {
                RelocationCount++;
                previous.PreviousEventIndexes.Add(previous.Event.EventIndex);
            }
            previous.Event = current;
            previous.Revision++;
            previous.LastUpdatedFrameTick = frameTick;
            SemanticRevisionCount++;
            Emit(MomentumEventUpdateKind.Update, previous, emitted);
        }

        return emitted;
    }

    public IReadOnlyList<LogicalMomentumEvent> GetSnapshot() => _eventsBySequence.Values
        .Select(state => new LogicalMomentumEvent(
            state.Event.SequenceIndex,
            state.Revision,
            state.FirstSeenFrameTick,
            state.LastUpdatedFrameTick,
            state.Event))
        .OrderBy(item => item.Event.Tick)
        .ThenBy(item => item.SequenceIndex)
        .ToArray();

    public IReadOnlyList<MomentumEventUpdate> GetUpdatesAfter(long updateSequence, int limit)
    {
        limit = Math.Clamp(limit, 1, 10_000);
        if (updateSequence >= LatestUpdateSequence) return Array.Empty<MomentumEventUpdate>();
        return _updates
            .Where(update => update.UpdateSequence > updateSequence)
            .Take(limit)
            .ToArray();
    }

    public void Reset()
    {
        _eventsBySequence.Clear();
        _updates.Clear();
        _nextUpdateSequence = 1;
        RelocationCount = 0;
        SemanticRevisionCount = 0;
        SequenceCollisionCount = 0;
    }

    internal static bool IsPlausibleSameLogicalEvent(
        NativeMomentumEventData previous,
        NativeMomentumEventData current) =>
        previous.SequenceIndex == current.SequenceIndex &&
        previous.Tick == current.Tick &&
        previous.Team == current.Team &&
        previous.PlayerSlot == current.PlayerSlot;

    internal static bool SameSemanticContent(
        NativeMomentumEventData previous,
        NativeMomentumEventData current) =>
        previous.SequenceIndex == current.SequenceIndex &&
        previous.Tick == current.Tick &&
        previous.LateralPosition == current.LateralPosition &&
        previous.LongitudinalPosition == current.LongitudinalPosition &&
        previous.Team == current.Team &&
        previous.PlayerSlot == current.PlayerSlot &&
        previous.PlayerId == current.PlayerId &&
        previous.ReceiverPlayerSlot == current.ReceiverPlayerSlot &&
        previous.ReceiverPlayerId == current.ReceiverPlayerId &&
        previous.EventType == current.EventType &&
        previous.Flags == current.Flags &&
        previous.CompletionTick == current.CompletionTick &&
        TrajectoryEquals(previous.TrajectoryPoints, current.TrajectoryPoints);

    private void Emit(
        MomentumEventUpdateKind kind,
        LogicalState state,
        ICollection<MomentumEventUpdate> emitted)
    {
        var update = new MomentumEventUpdate(
            _nextUpdateSequence++,
            kind,
            state.Event.SequenceIndex,
            state.Revision,
            state.Event);
        _updates.Add(update);
        emitted.Add(update);
    }

    private static bool TrajectoryEquals(
        IReadOnlyList<NativeMomentumTrajectoryPoint> left,
        IReadOnlyList<NativeMomentumTrajectoryPoint> right)
    {
        if (ReferenceEquals(left, right)) return true;
        if (left.Count != right.Count) return false;
        for (var index = 0; index < left.Count; index++)
        {
            if (left[index] != right[index]) return false;
        }
        return true;
    }

    private sealed class LogicalState
    {
        public LogicalState(
            NativeMomentumEventData @event,
            int revision,
            int firstSeenFrameTick,
            int lastUpdatedFrameTick)
        {
            Event = @event;
            Revision = revision;
            FirstSeenFrameTick = firstSeenFrameTick;
            LastUpdatedFrameTick = lastUpdatedFrameTick;
        }

        public NativeMomentumEventData Event;
        public int Revision;
        public int FirstSeenFrameTick { get; }
        public int LastUpdatedFrameTick;
        public HashSet<int> PreviousEventIndexes { get; } = new();
    }
}
