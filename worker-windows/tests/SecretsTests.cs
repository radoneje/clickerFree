using ClickerFree.Worker;
using Xunit;

namespace ClickerFree.Worker.Tests;

public class SecretsTests
{
    [Fact]
    public void FileStoreOptInRoundtrip()
    {
        var path = Path.Combine(Path.GetTempPath(), $"cf-secrets-{Guid.NewGuid():N}.json");
        var previous = Environment.GetEnvironmentVariable("CLICKERFREE_SECRET_FILE");
        Environment.SetEnvironmentVariable("CLICKERFREE_SECRET_FILE", path);
        try
        {
            var secret = Secrets.GetWorkerSecret();
            Assert.True(secret.Length >= 32);
            Assert.Equal(secret, Secrets.GetWorkerSecret());
            Secrets.StoreDeviceCredentials("device-1", "cred-1");
            var (deviceId, credential) = Secrets.GetDeviceCredentials();
            Assert.Equal("device-1", deviceId);
            Assert.Equal("cred-1", credential);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLICKERFREE_SECRET_FILE", previous);
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
