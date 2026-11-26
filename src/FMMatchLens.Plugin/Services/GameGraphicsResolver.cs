using System.Globalization;

namespace FMMatchLens.Plugin.Services;

// Only Pump calls the game. Hook and HTTP threads use managed strings/tasks.
internal sealed class GameGraphicsResolver : IDisposable
{
    private const int Capacity = 1024;
    private readonly object _gate = new();
    private readonly Func<string, string?>? _lookup;
    private readonly Dictionary<string, (string? Path, long Expires)> _cache = new();
    private readonly Dictionary<string, TaskCompletionSource<string?>> _pending = new();
    private readonly Queue<string> _queue = new();
    private bool _disposed;
    private long _nextWarning;

    public GameGraphicsResolver(Func<string, string?>? lookup) => _lookup = lookup;

    private Task<string?> Request(string entity, uint uid, string image)
    {
        var id = uid.ToString(CultureInfo.InvariantCulture);
        var key = (entity, image) switch
        {
            ("person", "portrait") => "person_" + id,
            ("club", "logo") => "club_" + id,
            ("comp", "logo") => "comp_" + id,
            _ => null
        };
        lock (_gate)
        {
            if (key is null || _disposed || _lookup is null) return Task.FromResult<string?>(null);
            if (_cache.TryGetValue(key, out var hit) && hit.Expires > Environment.TickCount64)
                return Task.FromResult(hit.Path);
            if (_pending.TryGetValue(key, out var pending)) return pending.Task;
            if (_pending.Count >= Capacity) return Task.FromResult<string?>(null);
            pending = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending.Add(key, pending);
            _queue.Enqueue(key);
            return pending.Task;
        }
    }

    public bool TryResolve(string entity, uint uid, string image, out string path)
    {
        var request = Request(entity, uid, image);
        path = request.IsCompletedSuccessfully ? request.Result ?? "" : "";
        return path.Length != 0;
    }

    public async Task<string?> ResolveAsync(string entity, uint uid, string image, CancellationToken cancellation)
    {
        try { return await Request(entity, uid, image).WaitAsync(TimeSpan.FromSeconds(3), cancellation).ConfigureAwait(false); }
        catch (TimeoutException) { return null; }
    }

    // Called exclusively by GraphicsPump.Update, with a per-frame work budget.
    public void Pump()
    {
        var start = Environment.TickCount64;
        for (var i = 0; i < 16 && Environment.TickCount64 - start < 4; i++)
        {
            string key;
            lock (_gate)
            {
                if (_disposed || _queue.Count == 0) return;
                key = _queue.Dequeue();
            }
            string? path = null;
            try
            {
                path = _lookup!(key);
                if (path is null && key.StartsWith("person_", StringComparison.Ordinal))
                    path = _lookup("newgen_" + key[7..]);
            }
            catch (Exception ex)
            {
                // A subsystem can disappear during shutdown/reinitialisation. Retry later.
                if (Environment.TickCount64 >= _nextWarning)
                {
                    _nextWarning = Environment.TickCount64 + 30000;
                    Diagnostics.PluginLogger.Warning($"Game graphics lookup deferred: {ex.GetBaseException().Message}");
                }
            }
            lock (_gate)
            {
                if (_disposed) return;
                if (_cache.Count >= Capacity) _cache.Clear();
                _cache[key] = (path, Environment.TickCount64 + (path is null ? 2000 : 10000));
                if (_pending.Remove(key, out var pending)) pending.TrySetResult(path);
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            foreach (var pending in _pending.Values) pending.TrySetResult(null);
            _pending.Clear();
            _queue.Clear();
            _cache.Clear();
        }
    }
}
