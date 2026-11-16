"""Сообщения воркера сразу на двух языках; выбор — настройка, не одновременный показ."""

import locale

MESSAGES = {
    "ru": {
        "already_running": "Воркер уже запущен. Второй экземпляр завершён.",
        "starting": "Запуск воркера ClickerFree {version}…",
        "pairing_code": "Код привязки: {code}\nОткройте {url} и введите код в кабинете.",
        "pairing_pending": "Ожидание подтверждения привязки…",
        "pairing_confirmed": "Компьютер привязан.",
        "pairing_expired": "Код привязки истёк. Запустите воркер заново.",
        "connected": "Подключено к серверу.",
        "disconnected": "Связь с сервером потеряна. Переподключение…",
        "version_unsupported": "Версия {version} не поддерживается. Минимальная: {min}. Обновите воркер.",
        "version_check_failed": "Не удалось проверить версию. Повторная попытка…",
        "keyring_unavailable": "Системное хранилище секретов недоступно: {error}",
        "unsupported_os": "Этот воркер поддерживает только macOS. Для Windows используйте нативный воркер.",
        "update_available": "Доступно обновление {version}. Скачайте вручную: {url}",
        "goodbye": "Воркер остановлен.",
    },
    "en": {
        "already_running": "The worker is already running. The second instance exited.",
        "starting": "Starting ClickerFree worker {version}…",
        "pairing_code": "Pairing code: {code}\nOpen {url} and enter the code in your dashboard.",
        "pairing_pending": "Waiting for pairing confirmation…",
        "pairing_confirmed": "Computer linked.",
        "pairing_expired": "The pairing code expired. Restart the worker.",
        "connected": "Connected to the server.",
        "disconnected": "Lost connection to the server. Reconnecting…",
        "version_unsupported": "Version {version} is unsupported. Minimum: {min}. Update the worker.",
        "version_check_failed": "Version check failed. Retrying…",
        "keyring_unavailable": "System secret storage is unavailable: {error}",
        "unsupported_os": "This worker supports macOS only. Use the native Windows worker on Windows.",
        "update_available": "Update {version} is available. Download manually: {url}",
        "goodbye": "Worker stopped.",
    },
}


def detect_lang(explicit: str | None = None, configured: str | None = None) -> str:
    for candidate in (explicit, configured):
        if candidate in MESSAGES:
            return candidate
    try:
        os_lang = (locale.getlocale()[0] or "").lower()
    except (ValueError, TypeError):
        os_lang = ""
    if os_lang.startswith("ru"):
        return "ru"
    if os_lang.startswith("en"):
        return "en"
    return "ru"


def t(lang: str, key: str, **params: object) -> str:
    return MESSAGES[lang][key].format(**params)
