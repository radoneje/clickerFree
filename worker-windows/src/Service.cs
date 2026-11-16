using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;

namespace ClickerFree.Worker;

public sealed record VersionInfo(
    [property: JsonPropertyName("latestVersion")] string LatestVersion,
    [property: JsonPropertyName("minSupportedVersion")] string MinSupportedVersion,
    [property: JsonPropertyName("protocolVersion")] int ProtocolVersion,
    [property: JsonPropertyName("downloadUrl")] string? DownloadUrl,
    [property: JsonPropertyName("manifestUrl")] string? ManifestUrl,
    [property: JsonPropertyName("sha256")] string? Sha256,
    [property: JsonPropertyName("descriptionKey")] string? DescriptionKey);

public sealed record PairingCodeResponse(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("expiresAt")] long ExpiresAt);

public sealed record PairingResult(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("deviceId")] string? DeviceId,
    [property: JsonPropertyName("credential")] string? Credential);

public static class Service
{
    public const string AppVersion = "0.1.0";
    // Должна совпадать с PROTOCOL_VERSION в packages/contracts.
    public const int ProtocolVersion = 1;

    public static string Arch =>
        RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "arm64" : "x64";

    public static async Task<VersionInfo> FetchVersion(HttpClient http, string server)
    {
        var url = $"{server}/api/worker/version?os=windows&arch={Arch}&appVersion={AppVersion}&protocolVersion={ProtocolVersion}";
        return await http.GetFromJsonAsync<VersionInfo>(url)
            ?? throw new InvalidOperationException("empty version response");
    }

    public static bool IsSupported(VersionInfo info) =>
        info.ProtocolVersion == ProtocolVersion && Semver.Compare(AppVersion, info.MinSupportedVersion) >= 0;

    public static async Task<PairingCodeResponse> RequestCode(
        HttpClient http, string server, WorkerConfig cfg, string secret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{server}/api/pairing/code");
        request.Headers.Add("x-worker-secret", secret);
        request.Content = JsonContent.Create(new
        {
            installId = cfg.InstallId,
            name = cfg.Name,
            os = "windows",
            arch = Arch,
            appVersion = AppVersion,
            protocolVersion = ProtocolVersion,
        });
        var response = await http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<PairingCodeResponse>()
            ?? throw new InvalidOperationException("empty pairing response");
    }

    public static async Task<PairingResult> FetchResult(
        HttpClient http, string server, string installId, string secret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{server}/api/pairing/result?installId={installId}");
        request.Headers.Add("x-worker-secret", secret);
        var response = await http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<PairingResult>()
            ?? throw new InvalidOperationException("empty pairing result");
    }
}
