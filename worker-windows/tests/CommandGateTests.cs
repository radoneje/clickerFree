using ClickerFree.Worker;
using Xunit;

namespace ClickerFree.Worker.Tests;

public class CommandGateTests
{
    [Fact]
    public void AcceptsFreshCommand()
    {
        var gate = new CommandGate();
        Assert.Equal("ok", gate.Accept("a", 2000, 1000));
    }

    [Fact]
    public void RejectsExpiredCommand()
    {
        var gate = new CommandGate();
        Assert.Equal("expired", gate.Accept("a", 1000, 1000));
        Assert.Equal("expired", gate.Accept("b", 500, 1000));
    }

    [Fact]
    public void RejectsDuplicateCommand()
    {
        var gate = new CommandGate();
        Assert.Equal("ok", gate.Accept("a", 2000, 1000));
        Assert.Equal("duplicate", gate.Accept("a", 2000, 1001));
    }

    [Fact]
    public void BoundedMemoryEvictsOldest()
    {
        var gate = new CommandGate(capacity: 2);
        gate.Accept("a", 2000, 1000);
        gate.Accept("b", 2000, 1000);
        gate.Accept("c", 2000, 1000);
        Assert.Equal("ok", gate.Accept("a", 2000, 1000));
        Assert.Equal("duplicate", gate.Accept("c", 2000, 1000));
    }
}
