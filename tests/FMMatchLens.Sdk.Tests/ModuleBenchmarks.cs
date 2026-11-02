using System.Diagnostics;
using System.Text.Json;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Sdk;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public class ModuleBenchmarks
{
    [Fact]
    public void RecordOptInProjectionAndFanoutMeasurements()
    {
        if (Environment.GetEnvironmentVariable("SDK_BENCHMARK") != "1") return;
        var rows = new List<object>();
        foreach (var players in new[] { 22, 64 })
            foreach (var consumers in new[] { 1, 5, 20 })
                foreach (var kind in new[] { "full-poll", "motion-poll", "motion-subscribe", "statistics-subscribe", "metadata-subscribe", "summary-subscribe", "momentum-subscribe" })
                {
                    double clock = 0;
                    using var hub = new MatchDataHub(clock: () => clock);
                    hub.SetSourceAvailability(true, "verified"); hub.Begin("source");
                    var f = Fixtures.Frame();
                    f = f with { Players = Enumerable.Range(0, players).Select(i => f.Players[0] with { Slot = i, PlayerId = 42 + i }).ToArray() };
                    var m = ExtendedSnapshotTests.Metadata();
                    m = m with { Players = Enumerable.Range(0, players).Select(i => m.Players[0] with { Slot = i, PlayerId = 42 + i, Uid = (uint)(42 + i) }).ToArray() };
                    var subscriptions = new List<ILensSubscription>();
                    long callbacks = 0; double published = 0; var delays = new List<double>();
                    void Received() { callbacks++; delays.Add(Stopwatch.GetTimestamp() - published); }
                    for (var c = 0; c < consumers; c++)
                    {
                        ILensSubscription? sub = kind switch
                        {
                            "motion-subscribe" => hub.SubscribeMotion(_ => Received()),
                            "statistics-subscribe" => hub.SubscribeStatistics(_ => Received(), new() { OnlyWhenChanged = false }),
                            "metadata-subscribe" => hub.SubscribeMetadata(_ => Received(), new() { OnlyWhenChanged = false }),
                            "summary-subscribe" => hub.SubscribeSummary(_ => Received()),
                            "momentum-subscribe" => hub.SubscribeMomentum(_ => Received(), new() { OnlyWhenChanged = false }),
                            _ => null
                        };
                        if (sub is not null) subscriptions.Add(sub);
                    }
                    void Iteration(int index)
                    {
                        clock += 1000;
                        published = Stopwatch.GetTimestamp();
                        hub.Publish(f with { Tick = index + 1, DisplayTick = index + 1 }, m);
                        if (kind == "full-poll") for (var c = 0; c < consumers; c++) hub.TryGetLatestSnapshot(out _);
                        else if (kind == "motion-poll") for (var c = 0; c < consumers; c++) hub.TryGetLatestMotion(out _);
                        else hub.Pump();
                    }
                    for (var i = 0; i < 10; i++) Iteration(i);
                    delays.Clear(); callbacks = 0;
                    var samples = new List<double>(); var allocated = GC.GetAllocatedBytesForCurrentThread();
                    for (var i = 10; i < 110; i++) { var start = Stopwatch.GetTimestamp(); Iteration(i); samples.Add(Stopwatch.GetElapsedTime(start).TotalMilliseconds); }
                    allocated = GC.GetAllocatedBytesForCurrentThread() - allocated; samples.Sort(); delays.Sort();
                    double P(List<double> values, double p) => values.Count == 0 ? 0 : values[(int)Math.Ceiling((values.Count - 1) * p)];
                    rows.Add(new
                    {
                        kind,
                        players,
                        consumers,
                        p50Ms = P(samples, .5),
                        p95Ms = P(samples, .95),
                        p99Ms = P(samples, .99),
                        allocatedBytesPerSource = allocated / 100,
                        callbacks,
                        callbackP95DelayMs = P(delays, .95) * 1000 / Stopwatch.Frequency,
                        projections = Enum.GetValues<DataModule>().ToDictionary(v => v.ToString(), v => hub.ProjectionCount(v)),
                        metadataFreezes = hub.MetadataProjectionCount
                    });
                    subscriptions.ForEach(s => s.Dispose());
                }
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(dir!.FullName, "Directory.Build.props"))) dir = dir.Parent;
        var outputDirectory = Path.Combine(dir.FullName, "artifacts", "sdk");
        Directory.CreateDirectory(outputDirectory);
        File.WriteAllText(Path.Combine(outputDirectory, "module-benchmarks.json"), JsonSerializer.Serialize(new
        {
            measuredUtc = DateTimeOffset.UtcNow,
            runtime = Environment.Version.ToString(),
            warmup = 10,
            iterations = 100,
            note = "Synthetic managed benchmark, excluding native capture and Unity rendering. Each source is made due; unchanged-only suppression is disabled for statistics, metadata and momentum to measure delivery costs. Delays are synchronous publish-to-callback CPU intervals, not in-game latency. Counts include warm-up.",
            results = rows
        }, new JsonSerializerOptions { WriteIndented = true }) + "\n");
    }
}
