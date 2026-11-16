import base64
import json

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from clickerfree_worker.release import _canonical, verify_manifest


def make_signed_manifest(private_key: Ed25519PrivateKey, payload: dict) -> dict:
    data = json.dumps(_canonical(payload), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    manifest = dict(payload)
    manifest["signature"] = base64.b64encode(private_key.sign(data)).decode("ascii")
    return manifest


def test_verify_accepts_valid_signature():
    private_key = Ed25519PrivateKey.generate()
    public_pem = private_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    manifest = make_signed_manifest(
        private_key,
        {"version": "9.9.9", "os": "macos", "arch": "arm64", "protocolVersion": 1, "files": []},
    )
    assert verify_manifest(manifest, public_pem) is True


def test_verify_rejects_tampered_manifest():
    private_key = Ed25519PrivateKey.generate()
    public_pem = private_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    manifest = make_signed_manifest(private_key, {"version": "9.9.9", "files": []})
    manifest["version"] = "10.0.0"
    assert verify_manifest(manifest, public_pem) is False


def test_verify_rejects_missing_or_foreign_signature():
    private_key = Ed25519PrivateKey.generate()
    public_pem = private_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    other_key = Ed25519PrivateKey.generate()
    assert verify_manifest({"version": "1.0.0"}, public_pem) is False
    foreign = make_signed_manifest(other_key, {"version": "1.0.0"})
    assert verify_manifest(foreign, public_pem) is False


def test_private_key_roundtrip_format():
    private_key = Ed25519PrivateKey.generate()
    pem = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
    assert pem.startswith(b"-----BEGIN PRIVATE KEY-----")
