using System.Text;
using System.Text.Json;
using ClickerFree.Worker;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
using Org.BouncyCastle.X509;
using Xunit;

namespace ClickerFree.Worker.Tests;

public class ReleaseTests
{
    static (string publicPem, Ed25519PrivateKeyParameters privatekey) GenerateKey()
    {
        var privatekey = new Ed25519PrivateKeyParameters(new SecureRandom());
        var publickey = privatekey.GeneratePublicKey();
        var der = SubjectPublicKeyInfoFactory.CreateSubjectPublicKeyInfo(publickey).GetDerEncoded();
        var pem = "-----BEGIN PUBLIC KEY-----\n" + Convert.ToBase64String(der) + "\n-----END PUBLIC KEY-----";
        return (pem, privatekey);
    }

    static string SignManifest(Ed25519PrivateKeyParameters key, string payloadJson)
    {
        var manifestJson = $"{{\"payload\":{payloadJson}}}";
        using var document = JsonDocument.Parse(manifestJson);
        var canonical = Release.CanonicalJson(document.RootElement);
        var signer = new Ed25519Signer();
        signer.Init(true, key);
        var data = Encoding.UTF8.GetBytes(canonical);
        signer.BlockUpdate(data, 0, data.Length);
        var signature = Convert.ToBase64String(signer.GenerateSignature());
        return $"{{\"payload\":{payloadJson},\"signature\":\"{signature}\"}}";
    }

    [Fact]
    public void AcceptsValidSignature()
    {
        var (pem, key) = GenerateKey();
        var manifest = SignManifest(key, "{\"version\":\"9.9.9\",\"files\":[]}");
        Assert.True(Release.VerifyManifest(manifest, pem));
    }

    [Fact]
    public void RejectsTamperedManifest()
    {
        var (pem, key) = GenerateKey();
        var manifest = SignManifest(key, "{\"version\":\"9.9.9\"}");
        var tampered = manifest.Replace("9.9.9", "10.0.0");
        Assert.False(Release.VerifyManifest(tampered, pem));
    }

    [Fact]
    public void RejectsMissingOrForeignSignature()
    {
        var (pem, _) = GenerateKey();
        var (_, otherKey) = GenerateKey();
        Assert.False(Release.VerifyManifest("{\"version\":\"1.0.0\"}", pem));
        var foreign = SignManifest(otherKey, "{\"version\":\"1.0.0\"}");
        Assert.False(Release.VerifyManifest(foreign, pem));
    }

    [Fact]
    public void CanonicalJsonSortsKeysAndOmitsWhitespace()
    {
        using var document = JsonDocument.Parse("{\"b\":1,\"a\":{\"d\":2,\"c\":[3,4]}}");
        Assert.Equal("{\"a\":{\"c\":[3,4],\"d\":2},\"b\":1}", Release.CanonicalJson(document.RootElement));
    }
}
