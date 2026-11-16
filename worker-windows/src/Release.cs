using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;

namespace ClickerFree.Worker;

// Манифест релиза принимается только с валидной подписью ed25519.
// SHA-256 файла проверяется при установке; обновление в v1 ручное.
public static class Release
{
    public const string PublicKeyPem = """
        -----BEGIN PUBLIC KEY-----
        MCowBQYDK2VwAyEAs9rQH7nMEPnFOwYy/WUMSAyAQUmVT1XMSmwYLSmxU5Q=
        -----END PUBLIC KEY-----
        """;

    public static string CanonicalJson(JsonElement element)
    {
        using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = false });
        WriteCanonical(writer, element);
        writer.Flush();
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    static void WriteCanonical(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray()) WriteCanonical(writer, item);
                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }

    public static bool VerifyManifest(string manifestJson, string publicKeyPem)
    {
        try
        {
            using var document = JsonDocument.Parse(manifestJson);
            if (!document.RootElement.TryGetProperty("signature", out var signatureElement)) return false;
            var signature = Convert.FromBase64String(signatureElement.GetString() ?? "");
            var payload = new Dictionary<string, JsonElement>();
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Name != "signature") payload[property.Name] = property.Value;
            }
            var canonical = CanonicalJson(JsonSerializer.SerializeToElement(payload));
            var der = Convert.FromBase64String(ExtractPemBody(publicKeyPem));
            var key = (Ed25519PublicKeyParameters)PublicKeyFactory.CreateKey(der);
            var verifier = new Ed25519Signer();
            verifier.Init(false, key);
            var data = Encoding.UTF8.GetBytes(canonical);
            verifier.BlockUpdate(data, 0, data.Length);
            return verifier.VerifySignature(signature);
        }
        catch
        {
            return false;
        }
    }

    static string ExtractPemBody(string pem) =>
        string.Join("", pem.Split('\n').Where(line => !line.StartsWith("-----")).Select(line => line.Trim()));

    public static async Task SuggestUpdateAsync(HttpClient http, VersionInfo info, string lang, Action<string> log)
    {
        if (info.ManifestUrl is null) return;
        try
        {
            var json = await http.GetStringAsync(info.ManifestUrl);
            if (!VerifyManifest(json, PublicKeyPem)) return;
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.TryGetProperty("protocolVersion", out var protocol) && protocol.GetInt32() != Service.ProtocolVersion) return;
            var version = root.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
            if (Semver.Compare(version, Service.AppVersion) <= 0) return;
            var url = "";
            if (root.TryGetProperty("files", out var files) && files.GetArrayLength() > 0)
            {
                url = files[0].TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
            }
            log(Messages.T(lang, "update_available", new Dictionary<string, string>
            {
                ["version"] = version,
                ["url"] = url,
            }));
        }
        catch
        {
            // Подсказка об обновлении не должна мешать работе воркера.
        }
    }
}
