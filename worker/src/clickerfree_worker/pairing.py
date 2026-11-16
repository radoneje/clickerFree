"""Привязка: одноразовый код + отдельный секрет воркера для получения ключа."""

import json
import platform
import sys
import urllib.request

from . import PROTOCOL_VERSION, __version__
from .config import Config
from .keys import UnsupportedOsError


def current_os() -> str:
    if sys.platform == "darwin":
        return "macos"
    raise UnsupportedOsError("this worker supports macOS only; use the native Windows worker")


def current_arch() -> str:
    return "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"


def _post(server: str, path: str, secret: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{server}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "x-worker-secret": secret},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def request_code(server: str, cfg: Config, secret: str) -> dict:
    return _post(
        server,
        "/api/pairing/code",
        secret,
        {
            "installId": cfg.install_id,
            "name": cfg.name,
            "os": current_os(),
            "arch": current_arch(),
            "appVersion": __version__,
            "protocolVersion": PROTOCOL_VERSION,
        },
    )


def fetch_result(server: str, install_id: str, secret: str) -> dict:
    request = urllib.request.Request(
        f"{server}/api/pairing/result?installId={install_id}",
        headers={"x-worker-secret": secret},
    )
    with urllib.request.urlopen(request, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))
