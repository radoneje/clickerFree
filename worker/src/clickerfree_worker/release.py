"""Проверка подписанного манифеста релиза (ed25519) и предложение обновления.

SHA-256 файла проверяется при установке; манифест без валидной подписи игнорируется.
Обновление в первой версии ручное и не выполняется во время выступления.
"""

import base64
import json
import urllib.request

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from . import PROTOCOL_VERSION, __version__
from .i18n import t
from .version import compare

# Публичный ключ подписи релизов (приватный ключ хранится вне Git у издателя).
PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAs9rQH7nMEPnFOwYy/WUMSAyAQUmVT1XMSmwYLSmxU5Q=
-----END PUBLIC KEY-----"""


def _canonical(value):
    if isinstance(value, dict):
        return {key: _canonical(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def verify_manifest(manifest: dict, public_key_pem: bytes = PUBLIC_KEY_PEM) -> bool:
    signature = manifest.get("signature")
    if not isinstance(signature, str):
        return False
    payload = {key: value for key, value in manifest.items() if key != "signature"}
    data = json.dumps(_canonical(payload), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    try:
        key = load_pem_public_key(public_key_pem)
        key.verify(base64.b64decode(signature), data)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def fetch_manifest(url: str, timeout: float = 5.0) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            manifest = json.loads(response.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - сеть/JSON могут быть недоступны
        return None
    if not isinstance(manifest, dict) or not verify_manifest(manifest):
        return None
    return manifest


def suggest_update(info: dict, lang: str, log=print) -> None:
    url = info.get("manifestUrl")
    if not url:
        return
    manifest = fetch_manifest(url)
    if manifest is None:
        return
    if manifest.get("protocolVersion") != PROTOCOL_VERSION:
        return
    version = manifest.get("version", "")
    if compare(version, __version__) > 0:
        files = manifest.get("files") or []
        download = files[0].get("url", "") if files else ""
        log(t(lang, "update_available", version=version, url=download))
