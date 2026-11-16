using ClickerFree.Worker;
using Xunit;

namespace ClickerFree.Worker.Tests;

public class MessagesTests
{
    [Fact]
    public void RuAndEnHaveIdenticalKeys()
    {
        Assert.Equal(Messages.All["ru"].Keys.OrderBy(k => k), Messages.All["en"].Keys.OrderBy(k => k));
    }

    [Fact]
    public void FormatsParameters()
    {
        var args = new Dictionary<string, string> { ["code"] = "ABCD2345", ["url"] = "http://x" };
        Assert.Contains("ABCD2345", Messages.T("ru", "pairing_code", args));
        Assert.Contains("ABCD2345", Messages.T("en", "pairing_code", args));
    }

    [Fact]
    public void DetectPrefersExplicitThenConfigured()
    {
        Assert.Equal("ru", Messages.Detect("ru", "en"));
        Assert.Equal("en", Messages.Detect(null, "en"));
        Assert.Equal("ru", Messages.Detect("xx", "yy"));
    }
}

public class SemverTests
{
    [Theory]
    [InlineData("1.0.0", "1.0.0", 0)]
    [InlineData("1.2.0", "1.10.0", -1)]
    [InlineData("2.0", "1.9.9", 1)]
    [InlineData("1.0.1", "1.0", 1)]
    [InlineData("abc", "0.0.0", 0)]
    public void Compares(string a, string b, int expected)
    {
        Assert.Equal(expected, Semver.Compare(a, b));
    }

    [Fact]
    public void IsSupportedChecksProtocolAndMinimum()
    {
        Assert.True(Service.IsSupported(new VersionInfo("0.1.0", "0.0.0", Service.ProtocolVersion, null, null, null)));
        Assert.True(Service.IsSupported(new VersionInfo("0.1.0", "0.1.0", Service.ProtocolVersion, null, null, null)));
        Assert.False(Service.IsSupported(new VersionInfo("0.1.0", "99.0.0", Service.ProtocolVersion, null, null, null)));
        Assert.False(Service.IsSupported(new VersionInfo("0.1.0", "0.0.0", Service.ProtocolVersion + 1, null, null, null)));
    }
}

public class ConfigTests
{
    [Fact]
    public void FirstLoadCreatesPersistentIdentity()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"cf-config-{Guid.NewGuid():N}");
        try
        {
            var cfg = ConfigStore.Load(dir);
            Assert.True(Guid.TryParse(cfg.InstallId, out _));
            Assert.NotEmpty(cfg.Name);
            var again = ConfigStore.Load(dir);
            Assert.Equal(cfg.InstallId, again.InstallId);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void ConfigFileContainsNoSecrets()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"cf-config-{Guid.NewGuid():N}");
        try
        {
            var cfg = ConfigStore.Load(dir) with { Lang = "en" };
            ConfigStore.Save(cfg, dir);
            var text = File.ReadAllText(Path.Combine(dir, "config.json"));
            Assert.DoesNotContain("credential", text);
            Assert.DoesNotContain("secret", text);
            Assert.Equal("en", ConfigStore.Load(dir).Lang);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }
}
