using System.Collections;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Sdk;
using Xunit;
using Side = FMMatchLens.Contracts.TeamSide;

namespace FMMatchLens.Sdk.Tests;

public class ModuleTests
{
    private static MatchDataHub Ready(Func<double>? clock = null)
    {
        var hub = new MatchDataHub(clock: clock ?? (() => 0));
        hub.SetSourceAvailability(true, "verified"); hub.Begin("source"); return hub;
    }
    [Fact]
    public void QueriesAreIndependentImmutableAndAgreeWithFullSnapshot()
    {
        using var hub = Ready();
        Assert.False(hub.TryGetLatestMotion(out _));
        hub.Publish(Fixtures.Frame(), null);
        Assert.True(hub.TryGetLatestMotion(out var motion));
        Assert.Equal(0, hub.SnapshotProjectionCount); Assert.Equal(0, hub.MetadataProjectionCount);
        Assert.Equal(0, hub.ProjectionCount(DataModule.Statistics));
        Assert.True(hub.TryGetLatestMotion(out var again)); Assert.Same(motion, again);
        hub.TryGetLatestSummary(out var summary); hub.TryGetLatestStatistics(out var stats);
        hub.TryGetLatestMetadata(out var metadata); hub.TryGetLatestMomentum(out var momentum);
        hub.TryGetLatestSnapshot(out var full);
        Assert.Equal(full!.BallPosition, motion.BallPosition);
        Assert.Equal(full.Players[0].Position, motion.Players[0].Position);
        Assert.Equal(full.Home.Goals, summary!.HomeGoals);
        Assert.Equal(full.Home.Statistics, stats!.Home);
        Assert.Equal(full.Players[0].Statistics, stats.Players[0].Statistics);
        Assert.Equal(full.Players[0].Metadata, metadata!.Players[0].Details);
        Assert.Equal(full.Momentum, momentum!.Momentum);
        Assert.Equal(full.Sequence, motion.Source.SourceSequence);
        Assert.Equal(full.CapturedAtUtc, motion.Source.CapturedAtUtc);
        Assert.Throws<NotSupportedException>(() => ((IList)motion.Players)[0] = motion.Players[0]);
        Assert.Throws<NotSupportedException>(() => ((IList)momentum.Momentum)[0] = momentum.Momentum[0]);
        hub.MarkLost("lost");
        Assert.False(hub.TryGetLatestMotion(out _)); Assert.False(hub.TryGetLatestStatistics(out _));
        Assert.False(hub.TryGetLatestSummary(out _)); Assert.False(hub.TryGetLatestMetadata(out _));
        Assert.False(hub.TryGetLatestMomentum(out _)); Assert.False(hub.TryGetLatestSnapshot(out _));
    }

    [Fact]
    public void SelectionIsFrozenIntersectedAndDoesNotRecomputeTeamStatistics()
    {
        using var hub = Ready();
        var f = Fixtures.Frame();
        f = f with
        {
            Players = new[] { f.Players[0], f.Players[0] with { Slot = 1, PlayerId = 43, Team = FMMatchLens.Plugin.Domain.TeamSide.Away } },
            Home = f.Home with { Goals = 4 }
        };
        var ids = new uint[] { 43, 42, 42 };
        MotionSnapshot? delivered = null;
        using var sub = hub.SubscribeMotion(s => delivered = s, new() { Selection = new() { Team = Side.Home, PlayerUids = ids } });
        ids[1] = 99;
        hub.Publish(f, null); hub.Pump();
        Assert.Equal(42, Assert.Single(delivered!.Players).PlayerId);
        Assert.Equal(f.BallHolderPlayerId, delivered.BallHolderPlayerId);
        hub.TryGetLatestStatistics(out var filtered, new() { PlayerUids = Array.Empty<uint>() });
        Assert.Empty(filtered!.Players); Assert.Equal(4, filtered.Home.Goals);
        hub.TryGetLatestMotion(out var none, new() { Team = Side.Away, PlayerUids = new uint[] { 42 } });
        Assert.Empty(none!.Players);
        hub.TryGetLatestMotion(out var away, new() { Team = Side.Away }); Assert.Equal(43, Assert.Single(away!.Players).PlayerId);
        Assert.Throws<ArgumentException>(() => hub.SubscribeMotion(_ => { }, new() { Selection = new() { PlayerUids = new uint[] { 0 } } }));
        Assert.Throws<ArgumentException>(() => hub.TryGetLatestMotion(out _, new() { Team = (Side)99 }));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(5)]
    [InlineData(20)]
    public void IdenticalConsumersShareProjectionAndLatestCandidatesAreBounded(int count)
    {
        double now = 0;
        using var hub = Ready(() => now);
        var received = Enumerable.Range(0, count).Select(_ => new List<MotionSnapshot>()).ToArray();
        var subscriptions = received.Select(list => hub.SubscribeMotion(list.Add)).ToArray();
        for (var i = 1; i <= 1000; i++) hub.Publish(Fixtures.Frame(i), null);
        Assert.Equal(0, hub.ProjectionCount(DataModule.Motion));
        Assert.All(subscriptions, s => Assert.Equal(1, s.GetDiagnostics().Pending));
        hub.Pump(); Assert.Equal(1, hub.ProjectionCount(DataModule.Motion));
        Assert.All(received, list => Assert.Equal(1000, Assert.Single(list).Source.Tick));
        Assert.All(received, list => Assert.Same(received[0][0], list[0]));
        Assert.All(subscriptions, s => { Assert.Equal(999, s.GetDiagnostics().Coalesced); Assert.Equal(0, s.GetDiagnostics().Dropped); });
        Assert.Equal(0, hub.SnapshotProjectionCount);
        hub.MarkLost("lost"); hub.Publish(Fixtures.Frame(1001), null); hub.Pump();
        Assert.Equal(2, hub.ProjectionCount(DataModule.Motion));
        Assert.All(received, list => { Assert.Equal(2, list.Count); Assert.NotEqual(list[0].Source.SessionId, list[1].Source.SessionId); });
        Assert.All(subscriptions, s => s.Dispose());
        Assert.Equal(0, hub.ProjectionGroupCount);
    }

    [Fact]
    public void RateInitialChangeDetectionAndReadCadenceAreIndependent()
    {
        double now = 0;
        using var hub = Ready(() => now);
        hub.Publish(Fixtures.Frame(), null);
        var motion = new List<MotionSnapshot>(); var stats = new List<StatisticsSnapshot>(); var summaries = new List<SummarySnapshot>();
        using var m = hub.SubscribeMotion(motion.Add);
        using var s = hub.SubscribeStatistics(stats.Add);
        using var summary = hub.SubscribeSummary(summaries.Add, new() { EmitInitial = false });
        hub.Pump(); Assert.Single(motion); Assert.Single(stats); Assert.Empty(summaries);
        hub.Publish(Fixtures.Frame(2), null); now = 100; hub.Pump();
        Assert.Single(motion); Assert.Single(stats); Assert.Single(summaries);
        hub.TryGetLatestStatistics(out var queried); Assert.Equal(2, queried!.Source.Tick);
        now = 250; hub.Pump(); Assert.Equal(2, motion.Count); Assert.Single(stats);
        now = 1000; hub.Pump(); Assert.Single(stats); Assert.Equal(1, s.GetDiagnostics().Suppressed);
        Assert.Equal(0, s.GetDiagnostics().Pending);
        hub.Publish(Fixtures.Frame(3) with { Home = default(TeamTickData) with { Goals = 1 } }, null);
        now = 2000; hub.Pump(); Assert.Equal(2, stats.Count); Assert.Equal(1, stats[^1].Home.Goals);
        Assert.Equal(stats[^1].Source.SessionId, s.GetDiagnostics().LastSessionId);
        foreach (var invalid in new[] { 0d, -1d, double.NaN, double.PositiveInfinity, double.Epsilon })
            Assert.Throws<ArgumentOutOfRangeException>(() => hub.SubscribeMotion(_ => { }, new() { MaxRateHz = invalid }));
    }

    [Fact]
    public void UnselectedPlayersDoNotTriggerChangedOnlyMotion()
    {
        double now = 0;
        using var hub = Ready(() => now);
        var f = Fixtures.Frame();
        f = f with { Players = new[] { f.Players[0], f.Players[0] with { Slot = 1, PlayerId = 43 } } };
        var received = new List<MotionSnapshot>();
        using var sub = hub.SubscribeMotion(received.Add, new() { OnlyWhenChanged = true, Selection = new() { PlayerUids = new uint[] { 42 } } });
        hub.Publish(f, null); hub.Pump();
        now = 250;
        hub.Publish(f with { Tick = 2, Players = new[] { f.Players[0], f.Players[1] with { X = 20 } } }, null);
        hub.Pump(); Assert.Single(received); Assert.Equal(1, sub.GetDiagnostics().Suppressed);
    }

    [Fact]
    public async Task ConcurrentReadsSingleFlightAndCustomQueriesDoNotAccumulateCaches()
    {
        using var hub = Ready(); hub.Publish(Fixtures.Frame(), null);
        var snapshots = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() => { hub.TryGetLatestMotion(out var s); return s; })));
        Assert.Equal(1, hub.ProjectionCount(DataModule.Motion)); Assert.All(snapshots, s => Assert.Same(snapshots[0], s));
        for (uint id = 1; id < 100; id++) hub.TryGetLatestMetadata(out _, new() { PlayerUids = new[] { id } });
        Assert.Equal(1, hub.ProjectionGroupCount);
    }

    [Fact]
    public void MetadataReusesFrozenDetailsAndReactsToSameTickChangesAndIdentityReplacement()
    {
        double now = 0; using var hub = Ready(() => now);
        var metadata = ExtendedSnapshotTests.Metadata();
        hub.Publish(Fixtures.Frame(), metadata);
        var delivered = new List<MetadataSnapshot>(); using var sub = hub.SubscribeMetadata(delivered.Add);
        hub.Pump(); var first = Assert.Single(delivered);
        Assert.Equal(87, first.Players[0].Details!.Attributes!.Technical["Passing"]);
        Assert.Equal(1, hub.MetadataProjectionCount); Assert.Equal(0, hub.SnapshotProjectionCount);
        now = 100; hub.Publish(Fixtures.Frame(2), metadata); hub.Pump(); Assert.Single(delivered);
        hub.TryGetLatestMetadata(out var same); Assert.Same(first.Players[0].Details, same!.Players[0].Details);
        hub.TryGetLatestSnapshot(out var full); Assert.Same(same.Players[0].Details, full!.Players[0].Metadata);
        var changed = metadata with { Home = metadata.Home with { Name = "Renamed" } };
        hub.UpdateMetadata(changed); now = 200; hub.Pump();
        Assert.Equal(2, delivered.Count); Assert.Equal(2, delivered[^1].Source.Tick);
        Assert.True(delivered[^1].Source.SourceSequence > same.Source.SourceSequence);
        Assert.Equal("Renamed", delivered[^1].Home.Name);
        var f = Fixtures.Frame(3); hub.Publish(f with { Players = new[] { f.Players[0] with { PlayerId = 99 } } }, changed);
        now = 300; hub.Pump(); Assert.Null(delivered[^1].Players[0].Details);
        Assert.Null(delivered[^1].Players[0].DisplayName);
        Assert.Equal("Alex Smith", first.Players[0].DisplayName);
        Assert.Equal(2, hub.MetadataProjectionCount);
        Assert.Throws<NotSupportedException>(() => ((System.Collections.IDictionary)first.Players[0].Details!.Attributes!.Technical)["Passing"] = 1);
    }

    [Fact]
    public void UnselectedMetadataEditsAreSuppressedAndNewSessionsIgnoreOldRateDeadline()
    {
        double now = 0; using var hub = Ready(() => now);
        var metadata = ExtendedSnapshotTests.Metadata();
        var p = metadata.Players[0]; metadata = metadata with { Players = new[] { p, p with { Slot = 1, PlayerId = 43, Uid = 43 } } };
        var f = Fixtures.Frame(); f = f with { Players = new[] { f.Players[0], f.Players[0] with { Slot = 1, PlayerId = 43 } } };
        hub.Publish(f, metadata);
        var got = new List<MetadataSnapshot>(); using var sub = hub.SubscribeMetadata(got.Add, new() { Selection = new() { PlayerUids = new uint[] { 42 } } });
        hub.Pump();
        hub.UpdateMetadata(metadata with { Players = new[] { p, metadata.Players[1] with { DisplayName = "Other", FirstName = "Other" } } });
        now = 100; hub.Pump(); Assert.Single(got); Assert.Equal(1, sub.GetDiagnostics().Suppressed);
        hub.End("source"); hub.Begin("source"); hub.Publish(Fixtures.Frame(), metadata); hub.Pump();
        Assert.Equal(2, got.Count); Assert.NotEqual(got[0].Source.SessionId, got[1].Source.SessionId);
        Assert.Equal(1, got[1].Source.SourceSequence);
    }

    [Fact]
    public void RatesShareCacheAndNoConsumerProducesAnyModuleDto()
    {
        double now = 0; using var hub = Ready(() => now);
        for (var i = 1; i <= 10000; i++) hub.Publish(Fixtures.Frame(i), null);
        foreach (var module in Enum.GetValues<DataModule>()) Assert.Equal(0, hub.ProjectionCount(module));
        var fast = new List<MotionSnapshot>(); var slow = new List<MotionSnapshot>();
        using var a = hub.SubscribeMotion(fast.Add); using var b = hub.SubscribeMotion(slow.Add, new() { MaxRateHz = 1 });
        hub.Pump(); Assert.Same(fast[0], slow[0]);
        hub.Publish(Fixtures.Frame(10001), null); now = 250; hub.Pump(); Assert.Equal(2, fast.Count); Assert.Single(slow);
        now = 1000; hub.Pump(); Assert.Same(fast[^1], slow[^1]); Assert.Equal(2, hub.ProjectionCount(DataModule.Motion));
        hub.Dispose(); Assert.Equal(0, hub.ProjectionGroupCount); Assert.False(hub.TryGetLatestMotion(out _));
        Assert.Throws<ObjectDisposedException>(() => hub.SubscribeMetadata(_ => { }));
    }

    [Fact]
    public void StateConsumersCanDisposeThrowOrExceedBudgetWithoutBreakingEvents()
    {
        double now = 0; using var hub = Ready(() => now);
        using var slow = hub.SubscribeMotion(_ => now += 11);
        var events = 0; using var e = hub.SubscribeEvents(_ => events++);
        hub.Publish(Fixtures.Frame(events: true), null); hub.Pump();
        Assert.NotNull(slow.GetDiagnostics().DisabledReason); Assert.Equal(0, events);
        hub.Pump(); Assert.Equal(1, events);
        using var bad = hub.SubscribeSummary(_ => throw new Exception("private"));
        ILensSubscription? self = null; self = hub.SubscribeMotion(_ => self!.Dispose());
        hub.Pump(); Assert.Equal(1, bad.GetDiagnostics().CallbackErrors); Assert.Equal("Disposed", self.GetDiagnostics().DisabledReason);
        hub.End("source"); Assert.False(hub.TryGetLatestSnapshot(out _));
    }
}
