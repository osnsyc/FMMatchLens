using System.Diagnostics.CodeAnalysis;

namespace FMMatchLens.Contracts;

/// <summary>Process-local discovery. Install exactly one Contracts assembly with the host.</summary>
public static partial class LensApi
{
    private static Registration? _registration;

    public static ILensMatchDataProvider? TryGetProvider() => Volatile.Read(ref _registration)?.Provider;

    /// <summary>Host-only by convention; this registry is not a security boundary.</summary>
    public static IDisposable RegisterProvider(ILensMatchDataProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);
        var registration = new Registration(provider);
        if (Interlocked.CompareExchange(ref _registration, registration, null) is not null)
            throw new InvalidOperationException("A Lens provider is already registered in this Contracts instance.");
        return registration;
    }

    private sealed class Registration(ILensMatchDataProvider provider) : IDisposable
    {
        public ILensMatchDataProvider Provider { get; } = provider;
        public void Dispose() => Interlocked.CompareExchange(ref _registration, null, this);
    }
}

/// <summary>Read-only managed data. Queries never read game memory. Callbacks run on Unity Update.</summary>
public interface ILensMatchDataProvider
{
    int ApiMajorVersion { get; }
    int ApiMinorVersion { get; }
    LensCapabilities Capabilities { get; }
    LensStatus Status { get; }
    bool TryGetLatestSnapshot([NotNullWhen(true)] out MatchSnapshot? snapshot);
    bool TryGetLatestMotion([NotNullWhen(true)] out MotionSnapshot? snapshot, PlayerSelection? selection = null);
    bool TryGetLatestSummary([NotNullWhen(true)] out SummarySnapshot? snapshot);
    bool TryGetLatestStatistics([NotNullWhen(true)] out StatisticsSnapshot? snapshot, PlayerSelection? selection = null);
    bool TryGetLatestMetadata([NotNullWhen(true)] out MetadataSnapshot? snapshot, PlayerSelection? selection = null);
    bool TryGetLatestMomentum([NotNullWhen(true)] out MomentumSnapshot? snapshot);
    ILensSubscription SubscribeMotion(Action<MotionSnapshot> callback, MotionSubscriptionOptions? options = null);
    ILensSubscription SubscribeSummary(Action<SummarySnapshot> callback, SummarySubscriptionOptions? options = null);
    ILensSubscription SubscribeStatistics(Action<StatisticsSnapshot> callback, StatisticsSubscriptionOptions? options = null);
    ILensSubscription SubscribeMetadata(Action<MetadataSnapshot> callback, MetadataSubscriptionOptions? options = null);
    ILensSubscription SubscribeMomentum(Action<MomentumSnapshot> callback, MomentumSubscriptionOptions? options = null);
    ILensSubscription SubscribeEvents(Action<MatchEventNotification> callback, EventSubscriptionOptions? options = null);
    ILensSubscription SubscribeLifecycle(Action<MatchLifecycleEvent> callback);
}

public interface ILensSubscription : IDisposable
{
    SubscriptionDiagnostics GetDiagnostics();
}
