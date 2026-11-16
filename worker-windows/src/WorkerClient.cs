using System.Text.Json;
using SocketIOClient;
using SocketIOClient.Common;

namespace ClickerFree.Worker;

public sealed class WorkerClient
{
    readonly CommandGate _gate = new();
    readonly SocketIO _client;

    public WorkerClient(string apiServer, string deviceId, string credential, string lang, Action<string> log)
    {
        _client = new SocketIO(new Uri($"{apiServer}/worker"), new SocketIOOptions
        {
            Transport = TransportProtocol.WebSocket,
            Reconnection = true,
            ReconnectionAttempts = int.MaxValue,
            ReconnectionDelayMax = 30000,
            Auth = new Dictionary<string, object>
            {
                ["deviceId"] = deviceId,
                ["credential"] = credential,
                ["appVersion"] = Service.AppVersion,
                ["os"] = "windows",
                ["arch"] = Service.Arch,
                ["protocolVersion"] = Service.ProtocolVersion,
            },
        });
        _client.OnConnected += (_, _) => log(Messages.T(lang, "connected"));
        _client.OnDisconnected += (_, _) => log(Messages.T(lang, "disconnected"));
        _client.On("control:command", async context =>
        {
            var data = context.GetValue<JsonElement>(0);
            var commandId = data.TryGetProperty("commandId", out var id) ? id.GetString() ?? "" : "";
            var action = data.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
            var expiresAt = data.TryGetProperty("expiresAt", out var e) ? e.GetInt64() : 0;

            var verdict = _gate.Accept(commandId, expiresAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (verdict != "ok")
            {
                await _client.EmitAsync("control:ack", new object[]
                {
                    new
                    {
                        commandId,
                        status = "rejected",
                        errorCode = verdict == "expired" ? "command_expired" : "command_duplicate",
                    },
                });
                return;
            }
            try
            {
                Keys.Press(action);
            }
            catch (Exception)
            {
                await _client.EmitAsync("control:ack", new object[]
                {
                    new { commandId, status = "rejected", errorCode = "internal_error" },
                });
                return;
            }
            // Подтверждение означает выполнение системного вызова, не смену слайда.
            await _client.EmitAsync("control:ack", new object[]
            {
                new { commandId, status = "executed" },
            });
        });
    }

    public Task ConnectAsync() => _client.ConnectAsync();
}
