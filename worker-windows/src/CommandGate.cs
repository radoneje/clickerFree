namespace ClickerFree.Worker;

public sealed class CommandGate
{
    readonly Queue<string> _order = new();
    readonly HashSet<string> _seen = new();
    readonly int _capacity;

    public CommandGate(int capacity = 1000)
    {
        _capacity = capacity;
    }

    public string Accept(string commandId, long expiresAtMs, long nowMs)
    {
        if (expiresAtMs <= nowMs) return "expired";
        if (!_seen.Add(commandId)) return "duplicate";
        _order.Enqueue(commandId);
        if (_order.Count > _capacity) _seen.Remove(_order.Dequeue());
        return "ok";
    }
}
