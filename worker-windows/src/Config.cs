using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClickerFree.Worker;

public sealed record WorkerConfig
{
    [JsonPropertyName("installId")] public string InstallId { get; init; } = "";
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("lang")] public string? Lang { get; init; }
    [JsonPropertyName("server")] public string Server { get; init; } = "http://localhost:3000";
    [JsonPropertyName("apiServer")] public string? ApiServer { get; init; }
}

public static class ConfigStore
{
    public static string DefaultDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ClickerFree");

    public static WorkerConfig Load(string? dir = null)
    {
        var path = Path.Combine(dir ?? DefaultDir, "config.json");
        if (File.Exists(path))
        {
            var loaded = JsonSerializer.Deserialize<WorkerConfig>(File.ReadAllText(path));
            if (loaded is not null && loaded.InstallId.Length > 0) return loaded;
        }
        var created = new WorkerConfig
        {
            InstallId = Guid.NewGuid().ToString(),
            Name = Environment.MachineName,
        };
        Save(created, dir);
        return created;
    }

    public static void Save(WorkerConfig cfg, string? dir = null)
    {
        var directory = dir ?? DefaultDir;
        Directory.CreateDirectory(directory);
        File.WriteAllText(
            Path.Combine(directory, "config.json"),
            JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));
    }
}
