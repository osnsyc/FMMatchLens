using FMMatchLens.Plugin.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FMMatchLens.Plugin.Services;

internal sealed class LocalApiServer : IDisposable
{
    public const int DefaultPort = ProjectMetadata.ApiPort;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly RealtimeMatchTimeline _timeline;
    private readonly MatchArchiveStore _archives;
    private readonly GraphicsAssetIndex _graphicsAssets;
    private readonly WebSocketHub _webSockets = new();
    private HttpListener? _listener;
    private CancellationTokenSource? _cancellation;
    private Timer? _realtimePublishTimer;
    private int _lastPublishedRealtimeTick = -1;
    private int _isPublishingRealtime;

    public LocalApiServer(
        RealtimeMatchTimeline timeline,
        MatchArchiveStore archives,
        GraphicsAssetIndex graphicsAssets)
    {
        _timeline = timeline;
        _archives = archives;
        _graphicsAssets = graphicsAssets;
    }

    public void Start()
    {
        if (_listener is not null)
        {
            return;
        }

        _cancellation = new CancellationTokenSource();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{DefaultPort}/");
        _listener.Start();
        _webSockets.Start();
        _realtimePublishTimer = new Timer(
            _ => PublishLatestRealtimeFrame(),
            null,
            TimeSpan.FromMilliseconds(250),
            TimeSpan.FromMilliseconds(250));

        _ = Task.Run(() => ListenAsync(_cancellation.Token), _cancellation.Token);
        PluginLogger.Info($"Local API listening on http://127.0.0.1:{DefaultPort}/.");
    }

    public void Stop()
    {
        _realtimePublishTimer?.Dispose();
        _realtimePublishTimer = null;
        _cancellation?.Cancel();

        try
        {
            _listener?.Stop();
            _listener?.Close();
        }
        catch
        {
            // Listener shutdown can race with pending requests.
        }

        _listener = null;
        _webSockets.Dispose();
        _cancellation?.Dispose();
        _cancellation = null;
        PluginLogger.Info("Local API stopped.");
    }

    public void Dispose()
    {
        Stop();
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && _listener is not null)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                PluginLogger.Warning($"HTTP listener error: {ex.Message}");
                continue;
            }

            _ = Task.Run(() => HandleAsync(context, cancellationToken), cancellationToken);
        }
    }

    private async Task HandleAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        try
        {
            AddCorsHeaders(context.Response);

            if (context.Request.HttpMethod == "OPTIONS")
            {
                context.Response.StatusCode = 204;
                context.Response.Close();
                return;
            }

            if (context.Request.IsWebSocketRequest && context.Request.Url?.AbsolutePath == "/ws")
            {
                var webSocketContext = await context.AcceptWebSocketAsync(null).ConfigureAwait(false);
                await _webSockets.AddAsync(webSocketContext.WebSocket, cancellationToken).ConfigureAwait(false);
                return;
            }

            var path = context.Request.Url?.AbsolutePath ?? "/";

            if (path.StartsWith("/api/assets/", StringComparison.Ordinal))
            {
                await HandleAssetRequestAsync(context, path, cancellationToken).ConfigureAwait(false);
                return;
            }

            if (path.StartsWith("/api/archives/", StringComparison.Ordinal))
            {
                await HandleArchiveRequestAsync(context, path, cancellationToken).ConfigureAwait(false);
                return;
            }

            switch (path)
            {
                case "/api/health":
                    var health = _timeline.GetStatus();
                    await WriteJsonAsync(context.Response, new
                    {
                        status = health.Status,
                        name = ProjectMetadata.Name,
                        pluginVersion = ProjectMetadata.Version,
                        game = ProjectMetadata.GameName,
                        gameVersion = ProjectMetadata.GameVersion,
                        projectUrl = ProjectMetadata.ProjectUrl,
                        authorBlogUrl = ProjectMetadata.AuthorBlogUrl,
                        koFiUrl = ProjectMetadata.KoFiUrl,
                        inMatch = health.MatchId is not null && health.Status != "ended",
                        tick = health.LastTick < 0 ? (int?)null : health.LastTick,
                        frameCount = health.FrameCount,
                        webSocketConnections = _webSockets.ConnectionCount
                    }, cancellationToken).ConfigureAwait(false);
                    break;
                case "/api/match/current":
                    await WriteJsonAsync(context.Response, _timeline.GetCurrent(), cancellationToken).ConfigureAwait(false);
                    break;
                case "/api/match/meta":
                    await WriteJsonAsync(context.Response, _timeline.GetMetadata(), cancellationToken).ConfigureAwait(false);
                    break;
                case "/api/match/status":
                    await WriteJsonAsync(context.Response, _timeline.GetStatus(), cancellationToken).ConfigureAwait(false);
                    break;
                case "/api/match/frames":
                    var query = context.Request.QueryString;
                    var fromTick = ParseQueryInt(query["fromTick"], 0);
                    var toTick = TryParseQueryInt(query["toTick"]);
                    var stride = ParseQueryInt(query["stride"], 1);
                    var limit = ParseQueryInt(query["limit"], 2_400);
                    await WriteJsonAsync(
                        context.Response,
                        _timeline.GetFrames(fromTick, toTick, stride, limit),
                        cancellationToken).ConfigureAwait(false);
                    break;
                case "/api/archives":
                    await WriteJsonAsync(context.Response, _archives.List(), cancellationToken).ConfigureAwait(false);
                    break;
                default:
                    context.Response.StatusCode = 404;
                    await WriteTextAsync(context.Response, "Not found", cancellationToken).ConfigureAwait(false);
                    break;
            }
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"HTTP request failed: {ex.Message}");
            if (context.Response.OutputStream.CanWrite)
            {
                context.Response.StatusCode = 500;
                await WriteTextAsync(context.Response, "Internal server error", cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task HandleAssetRequestAsync(HttpListenerContext context, string path, CancellationToken cancellationToken)
    {
        if (context.Request.HttpMethod != "GET")
        {
            context.Response.StatusCode = 405;
            await WriteTextAsync(context.Response, "Method not allowed", cancellationToken).ConfigureAwait(false);
            return;
        }

        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 5
            || segments[0] != "api"
            || segments[1] != "assets"
            || !uint.TryParse(segments[3], out var uid))
        {
            context.Response.StatusCode = 404;
            await WriteTextAsync(context.Response, "Asset not found", cancellationToken).ConfigureAwait(false);
            return;
        }

        var entityType = Uri.UnescapeDataString(segments[2]);
        var imageType = string.Join('/', segments.Skip(4).Select(Uri.UnescapeDataString));
        if (!_graphicsAssets.TryResolve(entityType, uid, imageType, out var assetPath))
        {
            context.Response.StatusCode = 404;
            await WriteTextAsync(context.Response, "Asset not found", cancellationToken).ConfigureAwait(false);
            return;
        }

        await WriteAssetAsync(context.Response, assetPath, cancellationToken).ConfigureAwait(false);
    }

    private static async Task WriteAssetAsync(
        HttpListenerResponse response,
        string assetPath,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(assetPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        response.ContentType = Path.GetExtension(assetPath).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            _ => "application/octet-stream"
        };
        response.Headers["Cache-Control"] = "public, max-age=86400";
        response.ContentLength64 = stream.Length;
        await stream.CopyToAsync(response.OutputStream, cancellationToken).ConfigureAwait(false);
        response.Close();
    }

    private async Task HandleArchiveRequestAsync(HttpListenerContext context, string path, CancellationToken cancellationToken)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length != 4 || segments[0] != "api" || segments[1] != "archives" || segments[3] != "frames")
        {
            context.Response.StatusCode = 404;
            await WriteTextAsync(context.Response, "Not found", cancellationToken).ConfigureAwait(false);
            return;
        }

        var matchId = Uri.UnescapeDataString(segments[2]);
        var query = context.Request.QueryString;
        if (!_archives.TryReadFrames(
                matchId,
                ParseQueryInt(query["fromTick"], 0),
                TryParseQueryInt(query["toTick"]),
                ParseQueryInt(query["stride"], 1),
                ParseQueryInt(query["limit"], 2_400),
                out var slice))
        {
            context.Response.StatusCode = 404;
            await WriteTextAsync(context.Response, "Archive not found", cancellationToken).ConfigureAwait(false);
            return;
        }

        await WriteJsonAsync(context.Response, slice, cancellationToken).ConfigureAwait(false);
    }

    private void PublishLatestRealtimeFrame()
    {
        if (Interlocked.Exchange(ref _isPublishingRealtime, 1) == 1)
        {
            return;
        }

        try
        {
            var frame = _timeline.GetCurrent();
            if (frame is null || frame.Tick == _lastPublishedRealtimeTick)
            {
                return;
            }

            _lastPublishedRealtimeTick = frame.Tick;
            _ = _webSockets.BroadcastAsync("realtime_tick", frame, CancellationToken.None);
        }
        finally
        {
            Interlocked.Exchange(ref _isPublishingRealtime, 0);
        }
    }

    private static int ParseQueryInt(string? value, int fallback)
    {
        return int.TryParse(value, out var parsed) ? parsed : fallback;
    }

    private static int? TryParseQueryInt(string? value)
    {
        return int.TryParse(value, out var parsed) ? parsed : null;
    }

    private static void AddCorsHeaders(HttpListenerResponse response)
    {
        response.Headers["Access-Control-Allow-Origin"] = "*";
        response.Headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
        response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    }

    private static Task WriteJsonAsync(HttpListenerResponse response, object? value, CancellationToken cancellationToken)
    {
        response.ContentType = "application/json; charset=utf-8";
        return WriteTextAsync(response, JsonSerializer.Serialize(value, JsonOptions), cancellationToken);
    }

    private static async Task WriteTextAsync(HttpListenerResponse response, string text, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        response.Close();
    }
}
