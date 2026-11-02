using System.Collections;
using FMMatchLens.Plugin.Sdk;
using Xunit;

namespace FMMatchLens.Sdk.Tests;

public class ProjectionRaceTests
{
    [Fact]
    public async Task SourceInvalidationDoesNotWaitForProjectionOrReturnItsStaleResult()
    {
        using var hub = new MatchDataHub(clock: () => 0);
        hub.SetSourceAvailability(true, "verified"); hub.Begin("source");
        using var values = new BlockingAttributes();
        var metadata = ExtendedSnapshotTests.Metadata();
        var player = metadata.Players[0];
        metadata = metadata with { Players = new[] { player with { Attributes = player.Attributes! with { Technical = values } } } };
        hub.Publish(Fixtures.Frame(), metadata);
        var oldSession = hub.Status.SessionId;
        var reader = Task.Run(() => hub.TryGetLatestMetadata(out _));
        try
        {
            Assert.True(await Task.Run(() => values.Entered.Wait(TimeSpan.FromSeconds(5))));
            await Task.Run(() => hub.MarkLost("source lost")).WaitAsync(TimeSpan.FromSeconds(5));
        }
        finally { values.Release.Set(); }
        Assert.False(await reader.WaitAsync(TimeSpan.FromSeconds(5)));
        hub.Publish(Fixtures.Frame(2), metadata);
        Assert.True(hub.TryGetLatestMetadata(out var current));
        Assert.NotEqual(oldSession, current.Source.SessionId);
        Assert.Equal(1, current.Source.SourceSequence);
        Assert.Equal(87, current.Players[0].Details!.Attributes!.Technical["Passing"]);
    }

    private sealed class BlockingAttributes : IReadOnlyDictionary<string, int>, IDisposable
    {
        private readonly Dictionary<string, int> _values = new() { ["Passing"] = 87 };
        public ManualResetEventSlim Entered { get; } = new();
        public ManualResetEventSlim Release { get; } = new();
        public int this[string key] => _values[key];
        public IEnumerable<string> Keys => _values.Keys;
        public IEnumerable<int> Values => _values.Values;
        public int Count => _values.Count;
        public bool ContainsKey(string key) => _values.ContainsKey(key);
        public bool TryGetValue(string key, out int value) => _values.TryGetValue(key, out value);
        public IEnumerator<KeyValuePair<string, int>> GetEnumerator()
        {
            Entered.Set();
            if (!Release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("Test projection was not released.");
            return _values.GetEnumerator();
        }
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        public void Dispose() { Entered.Dispose(); Release.Dispose(); }
    }
}
