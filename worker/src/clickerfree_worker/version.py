"""Проверка версии и совместимости протокола на старте."""

import json
import urllib.parse
import urllib.request

from . import PROTOCOL_VERSION, __version__


def compare(a: str, b: str) -> int:
    pa = [int(p) if p.isdigit() else 0 for p in a.split(".")]
    pb = [int(p) if p.isdigit() else 0 for p in b.split(".")]
    for i in range(3):
        diff = (pa[i] if i < len(pa) else 0) - (pb[i] if i < len(pb) else 0)
        if diff != 0:
            return -1 if diff < 0 else 1
    return 0


def fetch_version(server: str, os_name: str, arch: str, timeout: float = 5.0) -> dict:
    query = urllib.parse.urlencode(
        {
            "os": os_name,
            "arch": arch,
            "appVersion": __version__,
            "protocolVersion": PROTOCOL_VERSION,
        }
    )
    with urllib.request.urlopen(f"{server}/api/worker/version?{query}", timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def is_supported(info: dict) -> bool:
    return (
        info.get("protocolVersion") == PROTOCOL_VERSION
        and compare(__version__, info.get("minSupportedVersion", "0.0.0")) >= 0
    )
