namespace ClickerFree.Worker;

public static class Messages
{
    static readonly Dictionary<string, string> Ru = new()
    {
        ["already_running"] = "Воркер уже запущен. Второй экземпляр завершён.",
        ["starting"] = "Запуск воркера ClickerFree {version}…",
        ["pairing_code"] = "Код привязки: {code}\nОткройте {url} и введите код в кабинете.",
        ["pairing_pending"] = "Ожидание подтверждения привязки…",
        ["pairing_confirmed"] = "Компьютер привязан.",
        ["pairing_expired"] = "Код привязки истёк. Запустите воркер заново.",
        ["connected"] = "Подключено к серверу.",
        ["disconnected"] = "Связь с сервером потеряна. Переподключение…",
        ["version_unsupported"] = "Версия {version} не поддерживается. Минимальная: {min}. Обновите воркер.",
        ["version_check_failed"] = "Не удалось проверить версию. Повторная попытка…",
        ["credential_unavailable"] = "Не удалось получить доступ к хранилищу учётных данных: {error}",
        ["goodbye"] = "Воркер остановлен.",
    };

    static readonly Dictionary<string, string> En = new()
    {
        ["already_running"] = "The worker is already running. The second instance exited.",
        ["starting"] = "Starting ClickerFree worker {version}…",
        ["pairing_code"] = "Pairing code: {code}\nOpen {url} and enter the code in your dashboard.",
        ["pairing_pending"] = "Waiting for pairing confirmation…",
        ["pairing_confirmed"] = "Computer linked.",
        ["pairing_expired"] = "The pairing code expired. Restart the worker.",
        ["connected"] = "Connected to the server.",
        ["disconnected"] = "Lost connection to the server. Reconnecting…",
        ["version_unsupported"] = "Version {version} is unsupported. Minimum: {min}. Update the worker.",
        ["version_check_failed"] = "Version check failed. Retrying…",
        ["credential_unavailable"] = "Cannot access credential storage: {error}",
        ["goodbye"] = "Worker stopped.",
    };

    public static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> All =
        new Dictionary<string, IReadOnlyDictionary<string, string>> { ["ru"] = Ru, ["en"] = En };

    public static string Detect(string? explicitLang, string? configured)
    {
        foreach (var candidate in new[] { explicitLang, configured })
        {
            if (candidate is not null && All.ContainsKey(candidate)) return candidate;
        }
        var os = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        return os is "ru" or "en" ? os : "ru";
    }

    public static string T(string lang, string key, IReadOnlyDictionary<string, string>? args = null)
    {
        var text = All[lang][key];
        if (args is not null)
        {
            foreach (var (name, value) in args) text = text.Replace("{" + name + "}", value);
        }
        return text;
    }
}
