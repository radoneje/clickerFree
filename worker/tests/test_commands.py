from clickerfree_worker.commands import CommandGate


def test_accepts_fresh_command():
    gate = CommandGate()
    assert gate.accept("a", expires_at_ms=2000, now_ms=1000) == "ok"


def test_rejects_expired_command():
    gate = CommandGate()
    assert gate.accept("a", expires_at_ms=1000, now_ms=1000) == "expired"
    assert gate.accept("b", expires_at_ms=500, now_ms=1000) == "expired"


def test_rejects_duplicate_command():
    gate = CommandGate()
    assert gate.accept("a", expires_at_ms=2000, now_ms=1000) == "ok"
    assert gate.accept("a", expires_at_ms=2000, now_ms=1001) == "duplicate"


def test_bounded_memory_evicts_oldest():
    gate = CommandGate(capacity=2)
    gate.accept("a", 2000, 1000)
    gate.accept("b", 2000, 1000)
    gate.accept("c", 2000, 1000)
    assert gate.accept("a", 2000, 1000) == "ok"
    assert gate.accept("c", 2000, 1000) == "duplicate"
