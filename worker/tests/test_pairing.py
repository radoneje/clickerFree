import io
import json

from clickerfree_worker import pairing
from clickerfree_worker.config import Config


def test_os_and_arch_mapping(monkeypatch):
    monkeypatch.setattr(pairing.sys, "platform", "darwin")
    assert pairing.current_os() == "macos"
    monkeypatch.setattr(pairing.sys, "platform", "win32")
    try:
        pairing.current_os()
        raise AssertionError("expected UnsupportedOsError")
    except pairing.UnsupportedOsError:
        pass
    monkeypatch.setattr(pairing.sys, "platform", "linux")
    try:
        pairing.current_os()
        raise AssertionError("expected UnsupportedOsError")
    except pairing.UnsupportedOsError:
        pass
    monkeypatch.setattr(pairing.platform, "machine", lambda: "arm64")
    assert pairing.current_arch() == "arm64"
    monkeypatch.setattr(pairing.platform, "machine", lambda: "x86_64")
    assert pairing.current_arch() == "x64"


def test_request_code_sends_worker_secret_and_install_identity(monkeypatch):
    captured = {}

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.close()

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["secret"] = request.get_header("X-worker-secret")
        captured["body"] = json.loads(request.data)
        return FakeResponse(json.dumps({"code": "ABCD2345", "expiresAt": 1}).encode())

    monkeypatch.setattr(pairing.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(pairing, "current_os", lambda: "macos")
    monkeypatch.setattr(pairing, "current_arch", lambda: "arm64")
    cfg = Config(install_id="install-1", name="PC")
    result = pairing.request_code("http://x", cfg, "s" * 43)
    assert result["code"] == "ABCD2345"
    assert captured["url"] == "http://x/api/pairing/code"
    assert captured["secret"] == "s" * 43
    assert captured["body"]["installId"] == "install-1"
    assert captured["body"]["os"] == "macos"
    assert captured["body"]["protocolVersion"] == pairing.PROTOCOL_VERSION
