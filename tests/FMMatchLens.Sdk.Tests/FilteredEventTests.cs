using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Sdk;
using Xunit;
using Side = FMMatchLens.Contracts.TeamSide;

namespace FMMatchLens.Sdk.Tests;

public class FilteredEventTests
{
    [Fact]
    public void FutureOnlyReceiverFilteringAndScopeExitPreserveEventIdentity()
    {
        using var hub = new MatchDataHub(clock: () => 0);
        hub.SetSourceAvailability(true, "verified"); hub.Begin("source");
        hub.Publish(Fixtures.Frame(events: true), null);
        var notices = new List<MatchEventNotification>();
        var ids = new uint[] { 43 }; var types = new[] { 999 };
        using var sub = hub.SubscribeEvents(notices.Add, new() { Selection = new() { Team = Side.Home, PlayerUids = ids }, EventTypes = types });
        ids[0] = 99; types[0] = 7;
        hub.Pump(); Assert.Empty(notices);
        var update = Fixtures.Update(2) with { Operation = MomentumEventUpdateKind.Update, Revision = 1 };
        hub.Publish(Fixtures.Frame(2) with { MomentumEventUpdates = new[] { update } }, null); hub.Pump();
        var first = Assert.Single(notices); Assert.Equal(EventNotificationKind.Upsert, first.Kind);
        Assert.Equal(EventOperation.Update, first.Event!.Operation); Assert.Equal(2, first.Sequence);
        update = update with { Revision = 2, Event = update.Event with { EventType = 7 } };
        hub.Publish(Fixtures.Frame(3) with { MomentumEventUpdates = new[] { update } }, null); hub.Pump();
        Assert.Equal(EventNotificationKind.RemovedFromScope, notices[1].Kind); Assert.Null(notices[1].Event);
        Assert.Equal(first.SequenceIndex, notices[1].SequenceIndex); Assert.Equal(2, notices[1].Revision);
        update = update with { Revision = 3, Event = update.Event with { EventType = 999 } };
        hub.Publish(Fixtures.Frame(4) with { MomentumEventUpdates = new[] { update } }, null); hub.Pump();
        Assert.Equal(EventNotificationKind.Upsert, notices[2].Kind);
        hub.MarkLost("lost");
        update = update with { Revision = 4, Event = update.Event with { EventType = 7 } };
        hub.Publish(Fixtures.Frame(5) with { MomentumEventUpdates = new[] { update } }, null); hub.Pump();
        Assert.Equal(3, notices.Count); // Previous-session membership has been cleared.
    }
    [Fact]
    public void EmptyFiltersSuppressAllAndLateSubscribersDoNotReceiveQueuedEarlierEvents()
    {
        using var hub = new MatchDataHub(clock: () => 0);
        hub.SetSourceAvailability(true, "verified"); hub.Begin("source");
        var first = new List<MatchEventNotification>(); var late = new List<MatchEventNotification>();
        using var a = hub.SubscribeEvents(first.Add);
        using var empty = hub.SubscribeEvents(_ => throw new Exception(), new() { EventTypes = Array.Empty<int>() });
        using var noPlayers = hub.SubscribeEvents(_ => throw new Exception(), new() { Selection = new() { PlayerUids = Array.Empty<uint>() } });
        hub.Publish(Fixtures.Frame(events: true), null);
        using var b = hub.SubscribeEvents(late.Add);
        hub.Pump(); Assert.Single(first); Assert.Empty(late);
        Assert.Equal(0, empty.GetDiagnostics().CallbackErrors); Assert.Equal(0, noPlayers.GetDiagnostics().CallbackErrors);
    }
}
