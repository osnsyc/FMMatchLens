using FMMatchLens.Contracts;

namespace FMMatchLens.Plugin.Sdk;

internal interface IQueuedSubscription : ILensSubscription
{
    bool TryDispatch();
    void DropPending();
    void Disable(string reason);
}

internal abstract class SubscriptionBase<T> : IQueuedSubscription
{
    protected readonly object Gate = new();
    protected Action<T>? Callback;
    protected long Dropped, LastSequence, Errors, Coalesced, Suppressed;
    protected string? LastSession;
    protected readonly Func<double> Clock;
    private readonly Action<IQueuedSubscription> _remove;
    private readonly Action<string>? _warn;
    private readonly Action<double> _measure;
    private double _nextWarning;
    private string? _disabledReason;
    protected SubscriptionBase(Action<T> callback, Func<double> clock, Action<IQueuedSubscription> remove,
        Action<string>? warn, Action<double> measure)
    { Callback = callback; Clock = clock; _remove = remove; _warn = warn; _measure = measure; }
    protected abstract int PendingLocked { get; }
    protected abstract void ClearLocked();
    public abstract bool TryDispatch();
    protected bool InvokeSelected(Action<T> callback, T value)
    {
        var start = Clock();
        try { callback(value); }
        catch (Exception)
        {
            bool report;
            lock (Gate) { Errors++; report = Clock() >= _nextWarning; if (report) _nextWarning = Clock() + 5000; }
            if (report) Warn("Lens subscriber callback threw; exception isolated (details omitted).");
        }
        finally
        {
            var duration = Math.Max(0, Clock() - start); _measure(duration);
            if (duration > 10) { Disable("Callback exceeded 10ms; blocking callbacks are not supported."); Warn("Lens subscription disabled after a callback exceeded 10ms."); }
        }
        return true;
    }
    private void Warn(string message) { try { _warn?.Invoke(message); } catch { } }
    protected SubscriptionDiagnostics DiagnosticsLocked(int pending) => new(pending, Dropped, LastSequence, Errors, _disabledReason)
    { Coalesced = Coalesced, Suppressed = Suppressed, LastSessionId = LastSession };
    public virtual SubscriptionDiagnostics GetDiagnostics() { lock (Gate) return DiagnosticsLocked(PendingLocked); }
    public void DropPending() { lock (Gate) { Dropped += PendingLocked; ClearLocked(); } }
    public void Disable(string reason)
    {
        lock (Gate)
        {
            if (Callback is null) return;
            Callback = null; _disabledReason = reason; Dropped += PendingLocked; ClearLocked();
        }
        _remove(this);
    }
    public void Dispose() => Disable("Disposed");
}

internal class LensSubscription<T> : SubscriptionBase<T>
{
    private readonly Queue<(long Sequence, T Value)> _pending = new();
    private readonly int _capacity;
    public LensSubscription(Action<T> callback, int capacity, Func<double> clock,
        Action<IQueuedSubscription> remove, Action<string>? warn, Action<double> measure)
        : base(callback, clock, remove, warn, measure) => _capacity = capacity;
    protected override int PendingLocked => _pending.Count;
    protected override void ClearLocked() => _pending.Clear();
    protected void EnqueueLocked(long sequence, T value)
    {
        if (Callback is null) return;
        if (_pending.Count == _capacity) { _pending.Dequeue(); Dropped++; }
        _pending.Enqueue((sequence, value));
    }
    public void Enqueue(long sequence, T value) { lock (Gate) EnqueueLocked(sequence, value); }
    public override bool TryDispatch()
    {
        Action<T>? callback; (long Sequence, T Value) message;
        lock (Gate)
        {
            callback = Callback;
            if (callback is null || !_pending.TryDequeue(out message)) return false;
            LastSequence = message.Sequence;
            LastSession = message.Value switch { MatchEventNotification e => e.SessionId, MatchLifecycleEvent e => e.SessionId, _ => null };
        }
        return InvokeSelected(callback, message.Value);
    }
}

internal sealed class EventSubscription : LensSubscription<MatchEventNotification>
{
    private readonly FrozenSelection _selection;
    private readonly int[]? _types;
    private readonly HashSet<int> _matched = new();
    public EventSubscription(Action<MatchEventNotification> callback, FrozenSelection selection, int[]? types,
        Func<double> clock, Action<IQueuedSubscription> remove, Action<string>? warn, Action<double> measure)
        : base(callback, 1024, clock, remove, warn, measure) { _selection = selection; _types = types; }
    public void Offer(MatchEvent value)
    {
        lock (Gate)
        {
            if (Callback is null) return;
            var matches = _selection.MatchesTeam(value.Team) &&
                (_selection.MatchesPlayer(value.PlayerId) || _selection.MatchesPlayer(value.ReceiverPlayerId)) &&
                (_types is null || Array.BinarySearch(_types, value.EventType) >= 0);
            if (matches)
            {
                _matched.Add(value.SequenceIndex);
                EnqueueLocked(value.Sequence, new(value.SessionId, value.Sequence, value.SequenceIndex, value.Revision, EventNotificationKind.Upsert, value));
            }
            else if (_matched.Remove(value.SequenceIndex))
                EnqueueLocked(value.Sequence, new(value.SessionId, value.Sequence, value.SequenceIndex, value.Revision, EventNotificationKind.RemovedFromScope, null));
        }
    }
    protected override void ClearLocked() { base.ClearLocked(); _matched.Clear(); }
}

internal interface IStateSubscription : IQueuedSubscription { ProjectionGroup Group { get; } }
internal sealed class StateSubscription<T> : SubscriptionBase<T>, IStateSubscription where T : class, ILensStateSnapshot
{
    private readonly MatchDataHub _hub;
    public ProjectionGroup Group { get; }
    private readonly double _interval;
    private readonly bool _changed;
    private long _examined, _serial;
    private string? _session;
    private double _nextDue;
    private T? _lastValue;
    public StateSubscription(MatchDataHub hub, ProjectionGroup group, Action<T> callback,
        StateSubscriptionOptions options, SourceView? initial, Func<double> clock,
        Action<IQueuedSubscription> remove, Action<string>? warn, Action<double> measure)
        : base(callback, clock, remove, warn, measure)
    {
        _hub = hub; Group = group; _interval = 1000 / options.MaxRateHz; _changed = options.OnlyWhenChanged;
        _session = initial?.Session;
        _examined = initial is null ? 0 : initial.Sequence - (options.EmitInitial ? 1 : 0);
    }
    protected override int PendingLocked => 0; // Latest candidates live in the host, not a per-tick queue.
    protected override void ClearLocked()
    { _session = null; _examined = 0; _nextDue = 0; _lastValue = null; _serial++; }
    public override SubscriptionDiagnostics GetDiagnostics()
    {
        var source = _hub.CaptureSource(); // Never acquire the hub gate while holding Gate.
        lock (Gate) return DiagnosticsLocked(Callback is not null && source is not null &&
            (source.Session != _session || source.Sequence != _examined) ? 1 : 0);
    }
    public override bool TryDispatch()
    {
        var source = _hub.CaptureSource();
        if (source is null) return false;
        long serial;
        lock (Gate)
        {
            if (Callback is null) return false;
            if (_session != source.Session) { _session = source.Session; _examined = 0; _lastValue = null; _nextDue = 0; }
            if (_examined == source.Sequence || Clock() < _nextDue) return false;
            Coalesced += Math.Max(0, source.Sequence - _examined - 1);
            _examined = source.Sequence; _nextDue = Clock() + _interval; serial = _serial;
        }
        var value = (T)_hub.Project(Group, source);
        if (!_hub.IsCurrent(source)) return false;
        Action<T>? callback;
        lock (Gate)
        {
            if (Callback is null || serial != _serial) return false;
            if (_changed && _lastValue is not null && ModuleContent.Same(_lastValue, value)) { Suppressed++; return false; }
            _lastValue = value; LastSequence = source.Sequence; LastSession = source.Session; callback = Callback;
        }
        return InvokeSelected(callback, value);
    }
}
