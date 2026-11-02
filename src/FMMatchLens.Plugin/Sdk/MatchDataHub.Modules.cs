using System.Diagnostics.CodeAnalysis;
using FMMatchLens.Contracts;

namespace FMMatchLens.Plugin.Sdk;

internal sealed class ProjectionGroup(DataModule module, FrozenSelection selection, bool persistent)
{
    public DataModule Module { get; } = module;
    public FrozenSelection Selection { get; } = selection;
    public bool Persistent { get; } = persistent;
    public int References;
    private readonly object _gate = new();
    private long _epoch = -1, _sequence = -1;
    private Lazy<object>? _value;
    public void Invalidate(long epoch) { lock (_gate) { _epoch = epoch; _sequence = -1; _value = null; } }
    public object Get(SourceView source, Func<object> factory)
    {
        Lazy<object> value;
        lock (_gate)
        {
            if (_value is not null && _epoch == source.Epoch && _sequence == source.Sequence) value = _value;
            else
            {
                value = new(factory, LazyThreadSafetyMode.ExecutionAndPublication);
                if (source.Epoch > _epoch || (source.Epoch == _epoch && source.Sequence > _sequence))
                { _epoch = source.Epoch; _sequence = source.Sequence; _value = value; }
            }
        }
        return value.Value;
    }
}

internal sealed partial class MatchDataHub
{
    private long _epoch;
    private Lazy<SnapshotProjector.MetadataProjection?> _metadataProjection = new(() => null);
    private readonly object _projectionGate = new(), _metricsGate = new();
    private readonly Dictionary<(DataModule, string), ProjectionGroup> _groups = new();
    private readonly Dictionary<DataModule, long> _projectionCounts = new();
    private readonly Queue<double> _projectionDurations = new();
    private long _metadataProjectionCount, _projectionHits;
    private readonly List<IStateSubscription> _states = new();
    internal int SnapshotProjectionCount => (int)ProjectionCount(DataModule.Full);
    internal long MetadataProjectionCount => Interlocked.Read(ref _metadataProjectionCount);
    internal int ProjectionGroupCount { get { lock (_projectionGate) return _groups.Count; } }
    internal long ProjectionCount(DataModule module) { lock (_metricsGate) return _projectionCounts.GetValueOrDefault(module); }
    private string ProjectionDiagnostics()
    {
        lock (_metricsGate)
        {
            var values = _projectionDurations.OrderBy(v => v).ToArray();
            double P(double p) => values.Length == 0 ? 0 : values[(int)Math.Ceiling((values.Length - 1) * p)];
            return $"projections=[{string.Join(',', _projectionCounts.OrderBy(p => p.Key).Select(p => $"{p.Key}={p.Value}"))}], " +
                $"metadataFreezes={MetadataProjectionCount}, cacheHits={Interlocked.Read(ref _projectionHits)}, " +
                $"projectionP50/P95/P99={P(.5):F3}/{P(.95):F3}/{P(.99):F3}ms";
        }
    }
    private void InvalidateGroups()
    {
        lock (_projectionGate)
        {
            foreach (var entry in _groups.ToArray())
                if (entry.Value.References == 0) _groups.Remove(entry.Key);
                else entry.Value.Invalidate(_epoch);
        }
    }

    internal SourceView? CaptureSource()
    {
        lock (_gate) return _status.State == LensState.Active && _frame is not null && _sessionId is not null
            ? new(_epoch, _sessionId, _snapshotSequence, _frame, _metadata, _metadataProjection) : null;
    }
    internal bool IsCurrent(SourceView source)
    { lock (_gate) return !_disposed && _status.State == LensState.Active && _epoch == source.Epoch && _sessionId == source.Session; }
    private ProjectionGroup AcquireGroup(DataModule module, FrozenSelection selection, bool subscription)
    {
        lock (_projectionGate)
        {
            var key = (module, selection.Key);
            if (!_groups.TryGetValue(key, out var group))
                _groups[key] = group = new(module, selection, !subscription && selection.Key == FrozenSelection.All.Key);
            group.References++; return group;
        }
    }
    private void ReleaseGroup(ProjectionGroup group)
    {
        lock (_projectionGate)
        {
            if (--group.References == 0 && !group.Persistent)
            {
                if (_groups.TryGetValue((group.Module, group.Selection.Key), out var current) && ReferenceEquals(current, group))
                    _groups.Remove((group.Module, group.Selection.Key));
                group.Invalidate(Interlocked.Read(ref _epoch));
            }
        }
    }
    internal object Project(ProjectionGroup group, SourceView source)
    {
        var constructed = false;
        var value = group.Get(source, () =>
        {
            constructed = true;
            var start = _clock();
            var result = SnapshotProjector.ProjectModule(group.Module, source, group.Selection);
            lock (_metricsGate)
            {
                _projectionCounts[group.Module] = _projectionCounts.GetValueOrDefault(group.Module) + 1;
                _projectionDurations.Enqueue(Math.Max(0, _clock() - start));
                if (_projectionDurations.Count > 1024) _projectionDurations.Dequeue();
            }
            return result;
        });
        if (!constructed) Interlocked.Increment(ref _projectionHits);
        return value;
    }
    private bool Read<T>(DataModule module, PlayerSelection? selection, [NotNullWhen(true)] out T? snapshot) where T : class
    {
        var filter = selection is null ? FrozenSelection.All : new FrozenSelection(selection);
        snapshot = null;
        var source = CaptureSource(); if (source is null) return false;
        var group = AcquireGroup(module, filter, false);
        try
        {
            var value = (T)Project(group, source);
            if (!IsCurrent(source)) return false;
            snapshot = value; return true;
        }
        finally { ReleaseGroup(group); }
    }
    public bool TryGetLatestSnapshot([NotNullWhen(true)] out MatchSnapshot? snapshot) => Read(DataModule.Full, null, out snapshot);
    public bool TryGetLatestMotion([NotNullWhen(true)] out MotionSnapshot? snapshot, PlayerSelection? selection = null) => Read(DataModule.Motion, selection, out snapshot);
    public bool TryGetLatestSummary([NotNullWhen(true)] out SummarySnapshot? snapshot) => Read(DataModule.Summary, null, out snapshot);
    public bool TryGetLatestStatistics([NotNullWhen(true)] out StatisticsSnapshot? snapshot, PlayerSelection? selection = null) => Read(DataModule.Statistics, selection, out snapshot);
    public bool TryGetLatestMetadata([NotNullWhen(true)] out MetadataSnapshot? snapshot, PlayerSelection? selection = null) => Read(DataModule.Metadata, selection, out snapshot);
    public bool TryGetLatestMomentum([NotNullWhen(true)] out MomentumSnapshot? snapshot) => Read(DataModule.Momentum, null, out snapshot);

    private ILensSubscription SubscribeState<T>(DataModule module, Action<T> callback, StateSubscriptionOptions options,
        PlayerSelection? selection) where T : class, ILensStateSnapshot
    {
        ArgumentNullException.ThrowIfNull(callback);
        if (!double.IsFinite(options.MaxRateHz) || options.MaxRateHz <= 0 || !double.IsFinite(1000 / options.MaxRateHz))
            throw new ArgumentOutOfRangeException(nameof(options), "MaxRateHz must produce a finite positive interval.");
        var filter = selection is null ? FrozenSelection.All : new FrozenSelection(selection);
        var group = AcquireGroup(module, filter, true);
        try
        {
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(MatchDataHub));
                var subscription = new StateSubscription<T>(this, group, callback, options, CaptureSource(), _clock, Remove, _warn, Measure);
                _states.Add(subscription); _subscriptions.Add(subscription); return subscription;
            }
        }
        catch { ReleaseGroup(group); throw; }
    }
    public ILensSubscription SubscribeMotion(Action<MotionSnapshot> callback, MotionSubscriptionOptions? options = null)
    { options ??= new(); return SubscribeState(DataModule.Motion, callback, options, options.Selection); }
    public ILensSubscription SubscribeSummary(Action<SummarySnapshot> callback, SummarySubscriptionOptions? options = null)
    { options ??= new(); return SubscribeState(DataModule.Summary, callback, options, null); }
    public ILensSubscription SubscribeStatistics(Action<StatisticsSnapshot> callback, StatisticsSubscriptionOptions? options = null)
    { options ??= new(); return SubscribeState(DataModule.Statistics, callback, options, options.Selection); }
    public ILensSubscription SubscribeMetadata(Action<MetadataSnapshot> callback, MetadataSubscriptionOptions? options = null)
    { options ??= new(); return SubscribeState(DataModule.Metadata, callback, options, options.Selection); }
    public ILensSubscription SubscribeMomentum(Action<MomentumSnapshot> callback, MomentumSubscriptionOptions? options = null)
    { options ??= new(); return SubscribeState(DataModule.Momentum, callback, options, null); }
}
