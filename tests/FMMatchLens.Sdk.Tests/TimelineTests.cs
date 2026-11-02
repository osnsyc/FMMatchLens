using System.Text.Json;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Sdk;
using FMMatchLens.Plugin.Services;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public sealed class TimelineTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "lens-sdk-tests-" + Guid.NewGuid().ToString("N"));
    private RealtimeMatchTimeline Create(MatchDataHub? hub, string name, out MatchArchiveStore archives)
    {
        var directory = Path.Combine(_root, name);
        Directory.CreateDirectory(directory);
        archives = new MatchArchiveStore(directory);
        var timeline = new RealtimeMatchTimeline(archives, new GraphicsAssetIndex("", Path.Combine(directory, "cache.json")), hub);
        timeline.SetCaptureAvailability(true, "verified");
        timeline.Begin(1);
        return timeline;
    }

    [Fact]
    public void TimelineRetainsLastFrameForWebWhileSdkInvalidatesAndHandlesReusedAddress()
    {
        using var hub = new MatchDataHub();
        var timeline = Create(hub, "enabled", out var archives);
        using (archives)
        {
            Assert.True(timeline.Append(Fixtures.Raw(1)));
            Assert.True(hub.TryGetLatestSnapshot(out var first));
            Assert.False(timeline.Append(Fixtures.Raw(1)));
            Assert.False(timeline.Append(Fixtures.Raw(0)));
            hub.TryGetLatestSnapshot(out var same);
            Assert.Same(first, same);
            timeline.MarkEnded(1);
            Assert.Equal("ended", timeline.GetStatus().Status);
            Assert.NotNull(timeline.GetCurrentWireFrame());
            Assert.False(hub.TryGetLatestSnapshot(out _));
            timeline.Begin(1);
            Assert.True(timeline.Append(Fixtures.Raw(1)));
            Assert.True(hub.TryGetLatestSnapshot(out var next));
            Assert.NotEqual(first.SessionId, next.SessionId);
            timeline.MarkEnded(1);
        }
    }

    [Fact]
    public void MetadataChangeInvalidatesProjectionWithoutChangingTick()
    {
        using var hub = new MatchDataHub();
        var timeline = Create(hub, "metadata", out var archives);
        using (archives)
        {
            timeline.Append(Fixtures.Raw(1)); hub.TryGetLatestSnapshot(out var before);
            Assert.Null(before!.Players[0].DisplayName);
            var metadata = timeline.GetMetadata()!;
            var players = metadata.Players.Select(p => p with { FirstName = "Alex", DisplayName = "Alex", ShirtNumber = 9 }).ToArray();
            timeline.SetMetadata(metadata.Home, metadata.Away, players, null, null);
            Assert.True(hub.TryGetLatestSnapshot(out var after));
            Assert.NotSame(before, after);
            Assert.Equal(before.Tick, after.Tick);
            Assert.True(after.Sequence > before.Sequence);
            Assert.Equal("Alex", after.Players[0].DisplayName);
            Assert.Equal(9, after.Players[0].ShirtNumber);
            Assert.Null(before.Players[0].DisplayName);
            var substituted = Fixtures.Raw(2);
            substituted.Players[0] = substituted.Players[0] with { PlayerId = 99 };
            timeline.Append(substituted);
            Assert.True(hub.TryGetLatestSnapshot(out var newPlayer));
            Assert.Equal(99u, newPlayer.Players[0].Uid);
            Assert.Null(newPlayer.Players[0].DisplayName);
            timeline.MarkEnded(1);
        }
    }

    [Fact]
    public void DisabledAndEnabledSdkProduceEquivalentWireAndDecodedArchives()
    {
        using var hub = new MatchDataHub();
        var enabled = Create(hub, "enabled", out var enabledArchives);
        var disabled = Create(null, "disabled", out var disabledArchives);
        using (enabledArchives)
        using (disabledArchives)
        {
            for (var tick = 1; tick <= 5; tick++)
            {
                enabled.Append(Fixtures.Raw(tick)); disabled.Append(Fixtures.Raw(tick));
                Assert.True(hub.TryGetLatestSnapshot(out _));
            }
            enabled.MarkEnded(1); disabled.MarkEnded(1);
            // Match identity and managed timestamps are intentionally run-specific.
            var left = enabled.GetCurrentWireFrame()!;
            var right = disabled.GetCurrentWireFrame()! with { MatchId = left.MatchId, CapturedUnixMilliseconds = left.CapturedUnixMilliseconds };
            Assert.Equal(JsonSerializer.Serialize(left), JsonSerializer.Serialize(right));
        }
        var on = Read(Path.Combine(_root, "enabled"));
        var off = Read(Path.Combine(_root, "disabled"));
        Assert.Equal(5, on.Frames.Count);
        Assert.Equal(on.Frames.Count, off.Frames.Count);
        for (var i = 0; i < on.Frames.Count; i++)
        {
            var a = on.Frames[i];
            var b = off.Frames[i] with { MatchId = a.MatchId, CapturedUnixMilliseconds = a.CapturedUnixMilliseconds };
            Assert.Equal(JsonSerializer.Serialize(a), JsonSerializer.Serialize(b));
        }
    }

    private static ArchiveScanResult Read(string directory)
    {
        var path = Assert.Single(Directory.GetFiles(directory, "*.fmlens"));
        Assert.True(ArchiveReader.TryScan(path, 0, null, 1, 100, true, out var scan));
        return scan;
    }

    public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
}
