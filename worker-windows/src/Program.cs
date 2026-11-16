using System.Diagnostics;
using System.Text;
using ClickerFree.Worker;

Console.OutputEncoding = Encoding.UTF8;

string? serverArg = null, apiArg = null, langArg = null, nameArg = null;
for (var i = 0; i < args.Length; i++)
{
    if (i + 1 >= args.Length) break;
    switch (args[i])
    {
        case "--server": serverArg = args[++i]; break;
        case "--api-url": apiArg = args[++i]; break;
        case "--lang": langArg = args[++i]; break;
        case "--name": nameArg = args[++i]; break;
    }
}

var cfg = ConfigStore.Load();
if (serverArg is not null) cfg = cfg with { Server = serverArg.TrimEnd('/') };
if (apiArg is not null) cfg = cfg with { ApiServer = apiArg.TrimEnd('/') };
if (nameArg is not null) cfg = cfg with { Name = nameArg[..Math.Min(64, nameArg.Length)] };
if (langArg is not null) cfg = cfg with { Lang = langArg };
ConfigStore.Save(cfg);
var lang = Messages.Detect(langArg, cfg.Lang);

using var mutex = new Mutex(true, @"Local\ClickerFree.Worker", out var createdNew);
if (!createdNew)
{
    Console.WriteLine(Messages.T(lang, "already_running"));
    return 0;
}

Console.WriteLine(Messages.T(lang, "starting", new Dictionary<string, string> { ["version"] = Service.AppVersion }));

string secret;
try
{
    secret = Secrets.GetWorkerSecret();
}
catch (Exception err)
{
    Console.WriteLine(Messages.T(lang, "credential_unavailable", new Dictionary<string, string> { ["error"] = err.Message }));
    return 1;
}

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
VersionInfo? info = null;
for (var attempt = 0; attempt < 3; attempt++)
{
    try
    {
        info = await Service.FetchVersion(http, cfg.Server);
        break;
    }
    catch
    {
        Console.WriteLine(Messages.T(lang, "version_check_failed"));
        await Task.Delay(1000 * (1 << attempt));
    }
}
if (info is not null && !Service.IsSupported(info))
{
    Console.WriteLine(Messages.T(lang, "version_unsupported", new Dictionary<string, string>
    {
        ["version"] = Service.AppVersion,
        ["min"] = info.MinSupportedVersion,
    }));
    return 1;
}

var (deviceId, credential) = Secrets.GetDeviceCredentials();
if (deviceId is null || credential is null)
{
    PairingCodeResponse codeInfo;
    try
    {
        codeInfo = await Service.RequestCode(http, cfg.Server, cfg, secret);
    }
    catch (Exception err)
    {
        Console.WriteLine(Messages.T(lang, "credential_unavailable", new Dictionary<string, string> { ["error"] = err.Message }));
        return 1;
    }
    var pairingUrl = $"{cfg.Server}/{lang}/pairing";
    Console.WriteLine(Messages.T(lang, "pairing_code", new Dictionary<string, string>
    {
        ["code"] = codeInfo.Code,
        ["url"] = pairingUrl,
    }));
    try
    {
        Process.Start(new ProcessStartInfo(pairingUrl) { UseShellExecute = true });
    }
    catch
    {
        // Headless-сессия: браузер не открывается, код остаётся в консоли.
    }
    Console.WriteLine(Messages.T(lang, "pairing_pending"));
    var deadline = DateTime.UtcNow.AddSeconds(300);
    while (DateTime.UtcNow < deadline)
    {
        var result = await Service.FetchResult(http, cfg.Server, cfg.InstallId, secret);
        if (result.Status == "confirmed" && result.DeviceId is not null && result.Credential is not null)
        {
            deviceId = result.DeviceId;
            credential = result.Credential;
            Secrets.StoreDeviceCredentials(deviceId, credential);
            Console.WriteLine(Messages.T(lang, "pairing_confirmed"));
            break;
        }
        if (result.Status == "expired")
        {
            Console.WriteLine(Messages.T(lang, "pairing_expired"));
            return 1;
        }
        await Task.Delay(2000);
    }
    if (deviceId is null || credential is null)
    {
        Console.WriteLine(Messages.T(lang, "pairing_expired"));
        return 1;
    }
}

var client = new WorkerClient(cfg.ApiServer ?? cfg.Server, deviceId, credential, lang, Console.WriteLine);
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};
await client.ConnectAsync();
try
{
    await Task.Delay(Timeout.Infinite, cts.Token);
}
catch (OperationCanceledException)
{
}
Console.WriteLine(Messages.T(lang, "goodbye"));
return 0;
