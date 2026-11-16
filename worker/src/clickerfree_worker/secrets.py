"""Секреты — в системном хранилище (Keychain / Credential Manager).

Для headless-сред без доступа к системному хранилищу есть явный opt-in:
CLICKERFREE_SECRET_FILE=<путь> — JSON-файл с правами 0600. По умолчанию
используется только системное хранилище.
"""

import json
import os
import secrets
from pathlib import Path

import keyring

SERVICE = "clickerfree-worker"


def _file_path() -> Path | None:
    value = os.environ.get("CLICKERFREE_SECRET_FILE")
    return Path(value) if value else None


def _read_file(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    os.chmod(path, 0o600)


def _get(key: str) -> str | None:
    path = _file_path()
    if path is not None:
        return _read_file(path).get(key)
    return keyring.get_password(SERVICE, key)


def _set(key: str, value: str) -> None:
    path = _file_path()
    if path is not None:
        data = _read_file(path)
        data[key] = value
        _write_file(path, data)
        return
    keyring.set_password(SERVICE, key, value)


def get_worker_secret() -> str:
    value = _get("worker-secret")
    if not value:
        value = secrets.token_urlsafe(32)
        _set("worker-secret", value)
    return value


def get_device_credentials() -> tuple[str | None, str | None]:
    return _get("device-id"), _get("device-credential")


def store_device_credentials(device_id: str, credential: str) -> None:
    _set("device-id", device_id)
    _set("device-credential", credential)
