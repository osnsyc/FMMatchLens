using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using Side = FMMatchLens.Contracts.TeamSide;

namespace FMMatchLens.Plugin.Sdk;

/// <summary>Managed SDK side channel. Never calls consumer code from a publication/query path.</summary>
internal sealed partial class MatchDataHub : ILensMatchDataProvider, IDisposable
{
    private readonly object _gate = new();
    private readonly List<IQueuedSubscription> _subscriptions = new();
    private readonly List<EventSubscription> _events = new();
    private readonly List<LensSubscription<MatchLifecycleEvent>> _lifecycle = new();
    private readonly Func<double> _clock;
    private readonly Action<string>? _warn;
    private LensStatus _status = new(LensState.Unavailable, null, "Awaiting verified capture source");
    private bool _verified, _disposed;
    private string? _matchId, _sessionId;
    private RealtimeTickFrame? _frame;
    private RealtimeMatchMetadata? _metadata;
    private long _snapshotSequence, _eventSequence, _lifecycleSequence;
    private int _pumping, _pumpThread, _cursor;
    private readonly double[] _durations = new double[1024];
    private int _durationCount, _durationCursor, _queuePeak;

    public MatchDataHub(Action<string>? warn = null, Func<double>? clock = null)
    {
        _warn = warn;
        _clock = clock ?? (() => Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency);
        var attributes = typeof(LensApi).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .ToDictionary(a => a.Key, a => a.Value);
        ApiMajorVersion = int.Parse(attributes["LensApiMajor"]!);
        ApiMinorVersion = int.Parse(attributes["LensApiMinor"]!);
    }

    public int ApiMajorVersion { get; }
    public int ApiMinorVersion { get; }
    public LensStatus Status { get { lock (_gate) return _status; } }
    public LensCapabilities Capabilities
    {
        get
        {
            lock (_gate)
            {
                if (_status.State != LensState.Active || _frame is null) return LensCapabilities.None;
                var flags = LensCapabilities.MatchSnapshot | LensCapabilities.MatchEvents | LensCapabilities.MomentumSummary |
                    LensCapabilities.DetailedMatchStatistics;
                if (_frame.Players.Any(p => p.MovementValid && p.AngleDegrees is <= 360)) flags |= LensCapabilities.PlayerMovement;
                if (_metadata is { } metadata)
                {
                    if (metadata.MatchDate is not null || metadata.Competition is not null ||
                        metadata.Home.Uid is not null || metadata.Away.Uid is not null)
                        flags |= LensCapabilities.MatchMetadata;
                    foreach (var info in metadata.Players)
                    {
                        if (!_frame.Players.Any(p => p.Slot == info.Slot && p.PlayerId == info.PlayerId)) continue;
                        if (info.Profile is not null) flags |= LensCapabilities.PlayerProfiles;
                        if (info.Attributes is not null) flags |= LensCapabilities.PlayerAttributes;
                        if (info.InPossession is not null || info.OutOfPossession is not null) flags |= LensCapabilities.TacticalAssignments;
                        if (info.Profile?.SeasonStats is not null) flags |= LensCapabilities.SeasonStatistics;
                    }
                }
                if (_frame.Players.Any(p => p.PositionValid && SnapshotProjector.Position(p.X, p.Y, 0,
                        _frame.HalfPitchWidth, _frame.HalfPitchLength) is not null)) flags |= LensCapabilities.PlayerPositions;
                if (_frame.BallPositionValid && SnapshotProjector.Position(_frame.BallXCentimeters / 100f,
                        _frame.BallYCentimeters / 100f, _frame.BallZCentimeters / 100f,
                        _frame.HalfPitchWidth, _frame.HalfPitchLength) is not null) flags |= LensCapabilities.BallPosition;
                return flags;
            }
        }
    }

    internal void SetSourceAvailability(bool verified, string reason)
    {
        lock (_gate)
        {
            if (_disposed) return;
            _verified = verified;
            ClearFrameLocked();
            _sessionId = null;
            TransitionLocked(verified ? LensState.Waiting : LensState.Unavailable, reason);
        }
    }

    internal void Begin(string matchId)
    {
        lock (_gate)
        {
            if (_disposed || _matchId == matchId) return;
            ClearFrameLocked();
            _matchId = matchId;
            NewSessionLocked();
            TransitionLocked(_verified ? LensState.Waiting : LensState.Unavailable, "Match detected; awaiting frame");
        }
    }

    private void NewSessionLocked()
    {
        _sessionId = Guid.NewGuid().ToString("N");
        _snapshotSequence = _eventSequence = 0;
    }

    internal void Publish(RealtimeTickFrame frame, RealtimeMatchMetadata? metadata)
    {
        lock (_gate)
        {
            if (_disposed || !_verified || _matchId != frame.MatchId) return;
            if (_frame is not null && frame.Tick <= _frame.Tick) return;
            if (_sessionId is null) NewSessionLocked();
            _frame = frame; _snapshotSequence++;
            UpdateMetadataLocked(metadata);
            TransitionLocked(LensState.Active, "Receiving verified match frames");
            if (frame.MomentumEventUpdates is not { } updates) return;
            foreach (var update in updates)
            {
                var sequence = ++_eventSequence;
                if (_events.Count == 0) continue;
                var e = update.Event;
                var message = new MatchEvent(_sessionId!, sequence, update.SequenceIndex, update.Revision,
                    update.Operation == MomentumEventUpdateKind.Add ? EventOperation.Add : EventOperation.Update,
                    e.Tick, e.CompletionTick, (Side)e.Team, e.PlayerSlot, e.PlayerId == 0 ? null : e.PlayerId,
                    e.ReceiverPlayerSlot, e.ReceiverPlayerId == 0 ? null : e.ReceiverPlayerId, e.EventType, e.Flags,
                    SnapshotProjector.Position(e.LateralPosition, e.LongitudinalPosition, 0,
                        frame.HalfPitchWidth, frame.HalfPitchLength))
                { Trajectory = SnapshotProjector.Trajectory(e, frame.HalfPitchWidth, frame.HalfPitchLength) };
                foreach (var subscription in _events) subscription.Offer(message);
            }
            RecordQueuePeakLocked();
        }
    }

    internal void UpdateMetadata(RealtimeMatchMetadata metadata)
    {
        lock (_gate)
        {
            if (_disposed || _matchId != metadata.MatchId || ReferenceEquals(_metadata, metadata)) return;
            UpdateMetadataLocked(metadata);
            if (_frame is not null) _snapshotSequence++;
        }
    }

    private void UpdateMetadataLocked(RealtimeMatchMetadata? metadata)
    {
        if (ReferenceEquals(metadata, _metadata)) return;
        _metadata = metadata;
        var current = metadata;
        _metadataProjection = new(() =>
        {
            if (current is null) return null;
            Interlocked.Increment(ref _metadataProjectionCount);
            return SnapshotProjector.ProjectMetadata(current);
        });
    }

    internal void End(string matchId)
    {
        lock (_gate)
        {
            if (_disposed || _matchId != matchId) return;
            ClearFrameLocked();
            TransitionLocked(LensState.Ending, "Match ended");
            _matchId = _sessionId = null;
            TransitionLocked(_verified ? LensState.Waiting : LensState.Unavailable, "Match resources released");
        }
    }

    internal void MarkLost(string reason)
    {
        lock (_gate)
        {
            if (_disposed || !_verified || _status.State == LensState.Lost) return;
            ClearFrameLocked();
            TransitionLocked(LensState.Lost, reason);
            _sessionId = null;
        }
    }

    private void ClearFrameLocked()
    {
        _frame = null; _metadata = null; _metadataProjection = new(() => null); _epoch++;
        foreach (var subscription in _states) subscription.DropPending();
        InvalidateGroups();
        foreach (var subscription in _events) subscription.DropPending();
    }

    private void TransitionLocked(LensState state, string reason)
    {
        if (_status.State == state && _status.SessionId == _sessionId)
        {
            if (_status.Reason != reason) _status = new(state, _sessionId, reason);
            return;
        }
        var previous = _status.State;
        _status = new(state, _sessionId, reason);
        var sequence = ++_lifecycleSequence;
        if (_lifecycle.Count == 0) return;
        var message = new MatchLifecycleEvent(sequence, _sessionId, previous, state, reason);
        foreach (var subscription in _lifecycle) subscription.Enqueue(sequence, message);
        RecordQueuePeakLocked();
    }

    public ILensSubscription SubscribeEvents(Action<MatchEventNotification> callback, EventSubscriptionOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(callback);
        var selection = options?.Selection is { } selected ? new FrozenSelection(selected) : FrozenSelection.All;
        var types = options?.EventTypes?.Distinct().OrderBy(t => t).ToArray();
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(MatchDataHub));
            var subscription = new EventSubscription(callback, selection, types, _clock, Remove, _warn, Measure);
            _events.Add(subscription); _subscriptions.Add(subscription); return subscription;
        }
    }

    public ILensSubscription SubscribeLifecycle(Action<MatchLifecycleEvent> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(MatchDataHub));
            var subscription = new LensSubscription<MatchLifecycleEvent>(callback, 32, _clock, Remove, _warn, Measure);
            _lifecycle.Add(subscription); _subscriptions.Add(subscription);
            subscription.Enqueue(_lifecycleSequence, new(_lifecycleSequence, _status.SessionId,
                _status.State, _status.State, _status.Reason));
            return subscription;
        }
    }

    private void Remove(IQueuedSubscription subscription)
    {
        lock (_gate)
        {
            _subscriptions.Remove(subscription);
            if (subscription is EventSubscription e) _events.Remove(e);
            if (subscription is IStateSubscription state) { _states.Remove(state); ReleaseGroup(state.Group); }
            if (subscription is LensSubscription<MatchLifecycleEvent> l) _lifecycle.Remove(l);
        }
    }

    /// <summary>Called only by the Unity component. First call binds its thread; tests can drive a fake clock.</summary>
    internal void Pump()
    {
        var thread = Environment.CurrentManagedThreadId;
        var bound = Interlocked.CompareExchange(ref _pumpThread, thread, 0);
        if (bound != 0 && bound != thread) throw new InvalidOperationException("Lens dispatch must remain on its bound Unity thread.");
        if (Interlocked.Exchange(ref _pumping, 1) != 0) return;
        try
        {
            IQueuedSubscription[] subscribers;
            lock (_gate) subscribers = _subscriptions.ToArray();
            if (subscribers.Length == 0) return;
            var started = _clock();
            var delivered = 0;
            var empty = 0;
            var index = _cursor % subscribers.Length;
            while (delivered < 128 && _clock() - started < 2 && empty < subscribers.Length)
            {
                if (subscribers[index].TryDispatch()) { delivered++; empty = 0; } else empty++;
                index = (index + 1) % subscribers.Length;
            }
            _cursor = index;
        }
        finally { Volatile.Write(ref _pumping, 0); }
    }

    private void Measure(double duration)
    {
        lock (_metricsGate)
        {
            _durations[_durationCursor] = duration;
            _durationCursor = (_durationCursor + 1) % _durations.Length;
            _durationCount = Math.Min(_durationCount + 1, _durations.Length);
        }
    }

    private void RecordQueuePeakLocked() => _queuePeak = Math.Max(_queuePeak,
        _subscriptions.Count == 0 ? 0 : _subscriptions.Max(s => s.GetDiagnostics().Pending));

    internal string GetDispatchDiagnostics()
    {
        lock (_gate)
        {
            double[] samples;
            lock (_metricsGate) samples = _durations.Take(_durationCount).OrderBy(v => v).ToArray();
            double Percentile(double p) => samples.Length == 0 ? 0 : samples[(int)Math.Ceiling((samples.Length - 1) * p)];
            return $"SDK dispatch callbacks={samples.Length}, p50={Percentile(.5):F3}ms, p95={Percentile(.95):F3}ms, " +
                $"p99={Percentile(.99):F3}ms, queuePeak={_queuePeak}, " +
                $"dropped={_subscriptions.Sum(s => s.GetDiagnostics().Dropped)}, " +
                $"coalesced={_subscriptions.Sum(s => s.GetDiagnostics().Coalesced)}, " +
                $"suppressed={_subscriptions.Sum(s => s.GetDiagnostics().Suppressed)}, {ProjectionDiagnostics()}.";
        }
    }

    public void Dispose()
    {
        IQueuedSubscription[] subscriptions;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true; _verified = false;
            ClearFrameLocked();
            _matchId = _sessionId = null;
            TransitionLocked(LensState.Unavailable, "Provider unloaded");
            subscriptions = _subscriptions.ToArray();
        }
        foreach (var subscription in subscriptions) subscription.Disable("Provider unloaded");
    }
}
