using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using FMMatchLens.Plugin.Diagnostics;

namespace FMMatchLens.Plugin.Services;

internal sealed class WebSocketHub : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly object _gate = new();
    private readonly List<WebSocket> _connections = new();

    public int ConnectionCount
    {
        get
        {
            lock (_gate)
            {
                return _connections.Count;
            }
        }
    }

    public void Start()
    {
        PluginLogger.Debug("WebSocket hub started.");
    }

    public async Task AddAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            _connections.Add(socket);
        }

        await SendEnvelopeAsync(socket, "connection_status", new
        {
            status = "connected",
            connectionCount = ConnectionCount
        }, cancellationToken).ConfigureAwait(false);

        _ = Task.Run(() => ReceiveUntilClosedAsync(socket, cancellationToken), cancellationToken);
    }

    public async Task BroadcastAsync(string type, object payload, CancellationToken cancellationToken)
    {
        WebSocket[] sockets;
        lock (_gate)
        {
            sockets = _connections.ToArray();
        }

        foreach (var socket in sockets)
        {
            if (socket.State != WebSocketState.Open)
            {
                Remove(socket);
                continue;
            }

            try
            {
                await SendEnvelopeAsync(socket, type, payload, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                PluginLogger.Warning($"WebSocket send failed: {ex.Message}");
                Remove(socket);
            }
        }
    }

    public void Dispose()
    {
        WebSocket[] sockets;
        lock (_gate)
        {
            sockets = _connections.ToArray();
            _connections.Clear();
        }

        foreach (var socket in sockets)
        {
            socket.Dispose();
        }
    }

    private async Task ReceiveUntilClosedAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[256];

        try
        {
            while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
            }
        }
        catch
        {
            // Remote disconnects are expected.
        }
        finally
        {
            Remove(socket);
            socket.Dispose();
        }
    }

    private void Remove(WebSocket socket)
    {
        lock (_gate)
        {
            _connections.Remove(socket);
        }
    }

    private static Task SendEnvelopeAsync(WebSocket socket, string type, object payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(new
        {
            type,
            sentAt = DateTimeOffset.UtcNow,
            payload
        }, JsonOptions);

        var bytes = Encoding.UTF8.GetBytes(json);
        return socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }
}
