from clickerfree_worker.single_instance import InstanceLock


def test_second_instance_is_blocked(tmp_path):
    path = tmp_path / "worker.lock"
    first = InstanceLock(path)
    second = InstanceLock(path)
    assert first.acquire() is True
    assert second.acquire() is False
    first.release()
    assert second.acquire() is True
    second.release()


def test_release_is_idempotent(tmp_path):
    lock = InstanceLock(tmp_path / "worker.lock")
    lock.release()
    assert lock.acquire() is True
    lock.release()
    lock.release()
