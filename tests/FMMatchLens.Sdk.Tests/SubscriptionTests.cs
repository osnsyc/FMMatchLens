using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Sdk;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public class SubscriptionTests
{
    private static MatchDataHub Ready(Func<double>? clock = null)
    {
        var hub = new MatchDataHub(clock: clock ?? (() => 0));
        hub.SetSourceAvailability(true, "verified"); hub.Begin("source");
        return hub;
    }

    [Theory]
    [InlineData(1)] [InlineData(5)] [InlineData(20)]
    public void BurstHasBoundedQueuesFairDispatchAndExplicitDrops(int count)
    {
        using var hub = Ready();
        var received = new int[count];
        var subscriptions = Enumerable.Range(0, count).Select(index =>
            hub.SubscribeEvents(_ => received[index]++)).ToArray();
        for (var tick = 1; tick <= 1200; tick++) hub.Publish(Fixtures.Frame(tick, events: true), null);
        Assert.All(subscriptions, s =>
        {
            Assert.Equal(1024, s.GetDiagnostics().Pending);
            Assert.Equal(176, s.GetDiagnostics().Dropped);
        });
        hub.Pump();
        Assert.Equal(128, received.Sum());
        Assert.InRange(received.Max() - received.Min(), 0, 1);
        while (subscriptions.Any(s => s.GetDiagnostics().Pending > 0)) hub.Pump();
        Assert.All(received, n => Assert.Equal(1024, n));
        Assert.All(subscriptions, s => Assert.Equal(1200, s.GetDiagnostics().LastSequence));
        Assert.Contains("queuePeak=1024", hub.GetDispatchDiagnostics());
    }

    [Fact]
    public void LateSubscribersHaveNoReplayAndLifecycleGetsCurrentState()
    {
        using var hub = Ready();
        hub.Publish(Fixtures.Frame(events: true), null);
        var events = new List<MatchEvent>();
        var lifecycle = new List<MatchLifecycleEvent>();
        using var e = hub.SubscribeEvents(n => events.Add(n.Event!));
        using var l = hub.SubscribeLifecycle(lifecycle.Add);
        Assert.Empty(lifecycle);
        hub.Pump();
        Assert.Empty(events);
        Assert.Equal(LensState.Active, Assert.Single(lifecycle).State);
        hub.Publish(Fixtures.Frame(2, events: true), null); hub.Pump();
        Assert.Equal(2, Assert.Single(events).Sequence);
    }

    [Fact]
    public void ExceptionsAreIsolatedAndConsumerCanDisposeItself()
    {
        using var hub = Ready();
        using var bad = hub.SubscribeEvents(_ => throw new InvalidOperationException("private details"));
        var called = 0;
        ILensSubscription? good = null;
        good = hub.SubscribeEvents(_ => { called++; good!.Dispose(); });
        hub.Publish(Fixtures.Frame(events: true), null);
        hub.Publish(Fixtures.Frame(2, events: true), null);
        Assert.Equal(0, called);
        hub.Pump();
        Assert.Equal(1, called);
        Assert.Equal(2, bad.GetDiagnostics().CallbackErrors);
        Assert.Equal(0, good.GetDiagnostics().Pending);
        Assert.Equal("Disposed", good.GetDiagnostics().DisabledReason);
    }

    [Fact]
    public void SlowCallbackIsDisabledAfterItReturnsAndBudgetStopsDispatch()
    {
        double now = 0;
        using var hub = Ready(() => now);
        using var slow = hub.SubscribeEvents(_ => now += 11);
        var goodCalled = 0;
        using var good = hub.SubscribeEvents(_ => goodCalled++);
        hub.Publish(Fixtures.Frame(events: true), null);
        hub.Pump();
        Assert.NotNull(slow.GetDiagnostics().DisabledReason);
        Assert.Equal(0, goodCalled);
        hub.Pump();
        Assert.Equal(1, goodCalled);
    }

    [Fact]
    public void TwoMillisecondBudgetAndThreadBindingAreEnforced()
    {
        double now = 0;
        using var hub = Ready(() => now);
        var called = 0;
        using var sub = hub.SubscribeEvents(_ => { called++; now += .5; });
        for (var tick = 1; tick <= 20; tick++) hub.Publish(Fixtures.Frame(tick, events: true), null);
        hub.Pump();
        Assert.Equal(4, called);
        Exception? error = null;
        var thread = new Thread(() => { try { hub.Pump(); } catch (Exception e) { error = e; } });
        thread.Start(); thread.Join();
        Assert.IsType<InvalidOperationException>(error);
    }

    [Fact]
    public void EndingAndRecoveryDiscardQueuedOldEventsButKeepSubscriptions()
    {
        using var hub = Ready();
        var received = new List<MatchEvent>();
        using var sub = hub.SubscribeEvents(n => received.Add(n.Event!));
        hub.Publish(Fixtures.Frame(events: true), null);
        var oldSession = hub.Status.SessionId;
        hub.End("source");
        Assert.Equal(1, sub.GetDiagnostics().Dropped);
        hub.Begin("source"); hub.Publish(Fixtures.Frame(events: true), null);
        hub.Pump();
        Assert.NotEqual(oldSession, Assert.Single(received).SessionId);
        hub.MarkLost("lost"); hub.Publish(Fixtures.Frame(2, events: true), null);
        hub.Pump();
        Assert.Equal(2, received.Count);
        Assert.NotEqual(received[0].SessionId, received[1].SessionId);
    }

    [Fact]
    public void LifecycleOverflowIsObservableAndDisposeReleasesQueues()
    {
        using var hub = Ready();
        using var sub = hub.SubscribeLifecycle(_ => { });
        for (var i = 0; i < 100; i++) { hub.Begin($"m{i}"); hub.End($"m{i}"); }
        Assert.Equal(32, sub.GetDiagnostics().Pending);
        Assert.True(sub.GetDiagnostics().Dropped > 0);
        hub.Dispose();
        Assert.Equal(0, sub.GetDiagnostics().Pending);
        Assert.Equal("Provider unloaded", sub.GetDiagnostics().DisabledReason);
    }

    [Fact]
    public void NoConsumersDoNotCreatePublicSnapshotsDuringBurst()
    {
        using var hub = Ready();
        hub.Publish(Fixtures.Frame(1, events: true), null);
        var activeStatus = hub.Status;
        for (var tick = 2; tick <= 10_000; tick++) hub.Publish(Fixtures.Frame(tick, events: true), null);
        Assert.Same(activeStatus, hub.Status);
        Assert.Equal(0, hub.SnapshotProjectionCount);
        Assert.True(hub.TryGetLatestSnapshot(out var snapshot));
        Assert.Equal(10_000, snapshot.Tick);
        Assert.Equal(1, hub.SnapshotProjectionCount);
    }
}
