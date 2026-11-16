using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ClickerFree.Worker;

// По умолчанию учётные данные хранятся в Windows Credential Manager.
// Для headless-сессий (SSH без интерактивного входа) есть явный opt-in:
// CLICKERFREE_SECRET_FILE=<путь> — JSON-файл в профиле пользователя.
public static class Secrets
{
    const uint CredTypeGeneric = 1;
    const uint CredPersistLocalMachine = 2;

    static string? FilePath => Environment.GetEnvironmentVariable("CLICKERFREE_SECRET_FILE");

    static Dictionary<string, string> ReadFile()
    {
        var path = FilePath;
        if (path is null || !File.Exists(path)) return new Dictionary<string, string>();
        return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path)) ?? new();
    }

    static void WriteFile(Dictionary<string, string> data)
    {
        var path = FilePath!;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(data));
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credentialPtr);

    [DllImport("advapi32.dll")]
    static extern void CredFree(IntPtr buffer);

    static string Target(string key) => $"ClickerFree.Worker/{key}";

    public static string? Get(string key)
    {
        if (FilePath is not null) return ReadFile().GetValueOrDefault(key);
        if (!CredReadW(Target(key), CredTypeGeneric, 0, out var ptr)) return null;
        try
        {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            if (cred.CredentialBlobSize == 0 || cred.CredentialBlob == IntPtr.Zero) return null;
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.UTF8.GetString(bytes);
        }
        finally
        {
            CredFree(ptr);
        }
    }

    public static void Set(string key, string value)
    {
        if (FilePath is not null)
        {
            var data = ReadFile();
            data[key] = value;
            WriteFile(data);
            return;
        }
        var bytes = Encoding.UTF8.GetBytes(value);
        var blob = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var cred = new CREDENTIAL
            {
                Type = CredTypeGeneric,
                TargetName = Target(key),
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = CredPersistLocalMachine,
                UserName = "ClickerFree",
            };
            if (!CredWriteW(ref cred, 0))
            {
                throw new InvalidOperationException($"CredWrite failed: {Marshal.GetLastWin32Error()}");
            }
        }
        finally
        {
            Marshal.FreeCoTaskMem(blob);
        }
    }

    public static string GetWorkerSecret()
    {
        var value = Get("worker-secret");
        if (value is null)
        {
            value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');
            Set("worker-secret", value);
        }
        return value;
    }

    public static (string? DeviceId, string? Credential) GetDeviceCredentials() =>
        (Get("device-id"), Get("device-credential"));

    public static void StoreDeviceCredentials(string deviceId, string credential)
    {
        Set("device-id", deviceId);
        Set("device-credential", credential);
    }
}
