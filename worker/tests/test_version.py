from clickerfree_worker import PROTOCOL_VERSION
from clickerfree_worker.version import compare, is_supported


def test_compare():
    assert compare("1.0.0", "1.0.0") == 0
    assert compare("1.2.0", "1.10.0") == -1
    assert compare("2.0", "1.9.9") == 1
    assert compare("1.0.1", "1.0") == 1
    assert compare("abc", "0.0.0") == 0


def test_is_supported():
    assert is_supported({"protocolVersion": PROTOCOL_VERSION, "minSupportedVersion": "0.0.0"})
    assert is_supported({"protocolVersion": PROTOCOL_VERSION, "minSupportedVersion": "0.1.0"})
    assert not is_supported({"protocolVersion": PROTOCOL_VERSION, "minSupportedVersion": "99.0.0"})
    assert not is_supported({"protocolVersion": PROTOCOL_VERSION + 1, "minSupportedVersion": "0.0.0"})
