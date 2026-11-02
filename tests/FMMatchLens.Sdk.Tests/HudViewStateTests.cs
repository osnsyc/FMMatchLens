using FMMatchLens.Contracts;
using FMMatchLens.Examples.MinimalUnityHud;
using FMMatchLens.Plugin.Sdk;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public class HudViewStateTests
{
    private static MatchDataHub Ready()
    {
        var hub = new MatchDataHub(clock: () => 0);
        hub.SetSourceAvailability(true, "verified");
        hub.Begin("source");
        return hub;
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public void SessionReplacementClearsOldViewsBeforePollingOrCallbacks(bool callbacksFirst, bool endMatch)
    {
        using var hub = Ready();
        var view = new HudViewState();
        using var events = hub.SubscribeEvents(n => view.AcceptEvent(n, hub.Status));
        using var motion = hub.SubscribeMotion(s => view.AcceptMotion(s, hub.Status));
        using var summary = hub.SubscribeSummary(s => view.AcceptSummary(s, hub.Status));
        // Deliberately deliver lifecycle after data, including queued transitions from the old session.
        using var lifecycle = hub.SubscribeLifecycle(_ => view.SynchronizeSession(hub.Status));
        hub.Publish(Fixtures.Frame(events: true), null);
        hub.Pump();
        Assert.True(hub.TryGetLatestSnapshot(out var oldSnapshot));
        view.SetSnapshot(oldSnapshot, hub.Status);
        Assert.NotNull(view.Motion); Assert.NotNull(view.Summary); Assert.Single(view.RecentEvents);

        if (endMatch) { hub.End("source"); hub.Begin("next"); }
        else hub.MarkLost("temporary capture loss");
        // Both transitions complete before the consumer can observe a non-Active status.
        hub.Publish(Fixtures.Frame(2, endMatch ? "next" : "source", events: true), null);
        Assert.NotEqual(oldSnapshot.SessionId, hub.Status.SessionId);
        if (!callbacksFirst)
        {
            Assert.True(view.SynchronizeSession(hub.Status));
            Assert.Null(view.Snapshot); Assert.Null(view.Motion); Assert.Null(view.Summary);
            Assert.Empty(view.RecentEvents);
        }
        hub.Pump();
        // A later Update or stale lifecycle notice must preserve the newly accepted data.
        Assert.False(view.SynchronizeSession(hub.Status));
        Assert.Null(view.Snapshot);
        Assert.Equal(hub.Status.SessionId, view.Motion!.Source.SessionId);
        Assert.Equal(hub.Status.SessionId, view.Summary!.Source.SessionId);
        Assert.Single(view.RecentEvents);
    }

    [Fact]
    public void OldSessionCallbacksCannotReplaceRecoveredDataAndUnavailableClearsTheView()
    {
        using var hub = Ready();
        var view = new HudViewState();
        var notices = new List<MatchEventNotification>();
        using var events = hub.SubscribeEvents(notices.Add);
        hub.Publish(Fixtures.Frame(events: true), null); hub.Pump();
        Assert.True(hub.TryGetLatestSnapshot(out var oldSnapshot));
        Assert.True(hub.TryGetLatestMotion(out var oldMotion));
        Assert.True(hub.TryGetLatestSummary(out var oldSummary));
        var oldEvent = Assert.Single(notices);
        view.SetSnapshot(oldSnapshot, hub.Status);
        view.AcceptEvent(oldEvent, hub.Status);

        hub.MarkLost("temporary capture loss");
        hub.Publish(Fixtures.Frame(2, events: true), null); hub.Pump();
        Assert.True(hub.TryGetLatestSnapshot(out var snapshot));
        Assert.True(hub.TryGetLatestMotion(out var motion));
        Assert.True(hub.TryGetLatestSummary(out var summary));
        view.AcceptMotion(motion, hub.Status);
        view.AcceptSummary(summary, hub.Status);
        view.SetSnapshot(snapshot, hub.Status);
        view.AcceptEvent(notices[^1], hub.Status);

        view.AcceptEvent(oldEvent, hub.Status);
        view.AcceptMotion(oldMotion, hub.Status);
        view.AcceptSummary(oldSummary, hub.Status);
        view.SetSnapshot(oldSnapshot, hub.Status);
        Assert.Same(snapshot, view.Snapshot); Assert.Same(motion, view.Motion); Assert.Same(summary, view.Summary);
        Assert.Single(view.RecentEvents);

        hub.SetSourceAvailability(false, "capture stopped");
        view.SynchronizeSession(hub.Status);
        Assert.Null(view.Snapshot); Assert.Null(view.Motion); Assert.Null(view.Summary);
        Assert.Empty(view.RecentEvents);
    }
}
