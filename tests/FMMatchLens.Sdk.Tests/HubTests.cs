using System.Collections;
using System.Text.Json;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Sdk;
using FMMatchLens.Plugin.Services;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public class HubTests
{
    private static MatchDataHub Ready(Func<double>? clock = null)
    {
        var hub = new MatchDataHub(clock: clock);
        hub.SetSourceAvailability(true, "verified");
        hub.Begin("source");
        return hub;
    }

    [Fact]
    public void QueriesAreEmptyUntilVerifiedFrameAndUnknownBuildNeverLeaksData()
    {
        using var hub = new MatchDataHub();
        hub.Begin("source"); hub.Publish(Fixtures.Frame(), null);
        Assert.False(hub.TryGetLatestSnapshot(out _));
        Assert.Equal(LensCapabilities.None, hub.Capabilities);
        hub.SetSourceAvailability(false, "unverified build");
        Assert.Equal("unverified build", hub.Status.Reason);
        hub.SetSourceAvailability(true, "verified");
        Assert.False(hub.TryGetLatestSnapshot(out _));
        hub.Publish(Fixtures.Frame(), null);
        Assert.True(hub.TryGetLatestSnapshot(out var snapshot));
        Assert.Equal(1, snapshot.Sequence);
        Assert.Equal(1, hub.ApiMajorVersion);
        Assert.False(hub.Capabilities.HasFlag(LensCapabilities.RawMomentumEvents));
    }

    [Fact]
    public void SnapshotIsImmutableCachedAndUsesMetresIncludingBallHeight()
    {
        using var hub = Ready();
        var frame = Fixtures.Frame();
        hub.Publish(frame, null);
        Assert.Equal(0, hub.SnapshotProjectionCount);
        Assert.True(hub.TryGetLatestSnapshot(out var first));
        Assert.True(hub.TryGetLatestSnapshot(out var second));
        Assert.Same(first, second);
        Assert.Equal(new Position3(1.25f, -2.5f, 1.75f), first.BallPosition);
        Assert.Throws<NotSupportedException>(() => ((IList)first.Players)[0] = first.Players[0]);
        var source = (PlayerTickData[])frame.Players;
        source[0] = source[0] with { X = 20 };
        Assert.Equal(2, first.Players[0].Position!.Value.X);
        hub.Publish(Fixtures.Frame(2), null);
        Assert.True(hub.TryGetLatestSnapshot(out var next));
        Assert.NotSame(first, next);
        Assert.Equal(1, first.Tick);
        Assert.Equal(2, next.Sequence);
    }

    [Fact]
    public void InvalidPositionsAreNullAndFallbackIdRemainsSessionLocal()
    {
        using var hub = Ready();
        var frame = Fixtures.Frame() with { BallPositionValid = false };
        frame = frame with { Players = new[] { frame.Players[0] with { PlayerId = -1, X = 0, PositionValid = false } } };
        hub.Publish(frame, null);
        Assert.True(hub.TryGetLatestSnapshot(out var snapshot));
        Assert.Null(snapshot.BallPosition);
        Assert.Null(snapshot.Players[0].Position);
        Assert.Null(snapshot.Players[0].Uid);
        Assert.Equal(-1, snapshot.Players[0].PlayerId);
        Assert.False(hub.Capabilities.HasFlag(LensCapabilities.PlayerPositions));
        Assert.False(hub.Capabilities.HasFlag(LensCapabilities.BallPosition));
    }

    [Fact]
    public void EndLossRecoveryAndNewMatchNeverReuseSession()
    {
        using var hub = Ready();
        hub.Publish(Fixtures.Frame(), null);
        hub.TryGetLatestSnapshot(out var first);
        // A paused match has no publication; it remains available.
        Assert.True(hub.TryGetLatestSnapshot(out _));
        hub.MarkLost("source unreadable");
        Assert.Equal(LensState.Lost, hub.Status.State);
        Assert.False(hub.TryGetLatestSnapshot(out _));
        hub.Publish(Fixtures.Frame(2), null);
        hub.TryGetLatestSnapshot(out var restored);
        Assert.NotEqual(first!.SessionId, restored!.SessionId);
        Assert.Equal(1, restored.Sequence);
        hub.End("source");
        Assert.Equal(LensState.Waiting, hub.Status.State);
        Assert.False(hub.TryGetLatestSnapshot(out _));
        hub.Begin("source"); hub.Publish(Fixtures.Frame(), null);
        hub.TryGetLatestSnapshot(out var next);
        Assert.NotEqual(restored.SessionId, next!.SessionId);
        hub.Dispose();
        Assert.False(hub.TryGetLatestSnapshot(out _));
        Assert.Throws<ObjectDisposedException>(() => hub.SubscribeEvents(_ => { }));
    }

    [Fact]
    public async Task PublicationAndQueriesAreConsistentUnderContention()
    {
        using var hub = Ready();
        var writer = Task.Run(() => { for (var i = 1; i <= 2000; i++) hub.Publish(Fixtures.Frame(i), null); });
        var readers = Enumerable.Range(0, 5).Select(_ => Task.Run(() =>
        {
            long previous = 0;
            while (!writer.IsCompleted)
                if (hub.TryGetLatestSnapshot(out var s))
                {
                    Assert.Equal(s.Tick, s.Sequence);
                    Assert.True(s.Sequence >= previous);
                    Assert.Equal(42, s.Players[0].PlayerId);
                    previous = s.Sequence;
                }
        }));
        await Task.WhenAll(readers.Append(writer));
        Assert.True(hub.TryGetLatestSnapshot(out var last));
        Assert.Equal(2000, last.Sequence);
    }

    [Fact]
    public void ExistingReconcilerProducesOneIdentityWithSemanticRevisions()
    {
        var reconciler = new MomentumEventReconciler();
        var first = Assert.Single(reconciler.Apply(1, new[] { Fixtures.Event() }));
        Assert.Empty(reconciler.Apply(2, new[] { Fixtures.Event(99) }));
        var changed = Assert.Single(reconciler.Apply(3, new[] { Fixtures.Event(99) with { Flags = 8 } }));
        using var hub = Ready(() => 0);
        var delivered = new List<MatchEvent>();
        using var sub = hub.SubscribeEvents(n => delivered.Add(n.Event!));
        hub.Publish(Fixtures.Frame() with { MomentumEventUpdates = new[] { first } }, null);
        hub.Publish(Fixtures.Frame(2) with { MomentumEventUpdates = new[] { changed } }, null);
        hub.Pump();
        Assert.Equal(new[] { EventOperation.Add, EventOperation.Update }, delivered.Select(e => e.Operation));
        Assert.Equal(new[] { 0, 1 }, delivered.Select(e => e.Revision));
        Assert.Equal(new long[] { 1, 2 }, delivered.Select(e => e.Sequence));
        Assert.All(delivered, e => { Assert.Equal(100, e.SequenceIndex); Assert.Equal(999, e.EventType); });
    }

    [Fact]
    public void PublicationDoesNotChangeExistingWireOrArchivePayload()
    {
        using var hub = Ready();
        var frame = Fixtures.Frame();
        frame = frame with { Players = frame.Players.Select(p => p with { MovementValid = true,
            AngleDegrees = 90, SpeedCentimetersPerSecond = 321 }).ToArray() };
        var legacy = frame with { BallPositionValid = false,
            Players = frame.Players.Select(p => p with { PositionValid = false, MovementValid = false }).ToArray() };
        var jsonBefore = JsonSerializer.Serialize(legacy.ToWireFrame());
        var archiveBefore = ArchiveFrameCodec.Encode(new[] { legacy });
        hub.Publish(frame, null); hub.TryGetLatestSnapshot(out _);
        Assert.Equal(jsonBefore, JsonSerializer.Serialize(frame.ToWireFrame()));
        Assert.Equal(archiveBefore, ArchiveFrameCodec.Encode(new[] { frame }));
        Assert.DoesNotContain("PositionValid", jsonBefore);
        var decoded = Assert.Single(ArchiveFrameCodec.Decode(archiveBefore, frame.MatchId, 1, ArchiveWireFormat.StructureMinor));
        Assert.Equal(frame.Tick, decoded.Tick);
        Assert.Equal(frame.BallZCentimeters, decoded.BallZCentimeters);
    }
}
