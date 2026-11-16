import os
import stat

from clickerfree_worker import secrets


def test_file_store_opt_in(tmp_path, monkeypatch):
    path = tmp_path / "secrets.json"
    monkeypatch.setenv("CLICKERFREE_SECRET_FILE", str(path))
    first = secrets.get_worker_secret()
    assert len(first) >= 32
    assert secrets.get_worker_secret() == first
    secrets.store_device_credentials("device-1", "cred-1")
    assert secrets.get_device_credentials() == ("device-1", "cred-1")
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600


def test_default_uses_keyring(monkeypatch):
    monkeypatch.delenv("CLICKERFREE_SECRET_FILE", raising=False)
    stored = {}
    monkeypatch.setattr(secrets.keyring, "get_password", lambda s, k: stored.get(k))
    monkeypatch.setattr(secrets.keyring, "set_password", lambda s, k, v: stored.update({k: v}))
    value = secrets.get_worker_secret()
    assert stored["worker-secret"] == value
    secrets.store_device_credentials("d", "c")
    assert secrets.get_device_credentials() == ("d", "c")
