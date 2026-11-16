from clickerfree_worker.client import make_command_handler
from clickerfree_worker.commands import CommandGate


def run_handler(press_fn, payloads):
    gate = CommandGate()
    emitted = []
    handler = make_command_handler(gate, lambda event, data: emitted.append((event, data)), "ru", press_fn)
    for payload in payloads:
        handler(payload)
    return emitted


def command(command_id="c1", action="next", expires=None):
    import time

    return {
        "commandId": command_id,
        "action": action,
        "controlSessionId": "s1",
        "expiresAt": expires if expires is not None else int(time.time() * 1000) + 2000,
    }


def test_executes_and_acks():
    pressed = []
    emitted = run_handler(pressed.append, [command()])
    assert pressed == ["next"]
    assert emitted == [("control:ack", {"commandId": "c1", "status": "executed"})]


def test_expired_command_is_not_pressed():
    pressed = []
    emitted = run_handler(pressed.append, [command(expires=1)])
    assert pressed == []
    assert emitted[0][1]["errorCode"] == "command_expired"


def test_duplicate_command_is_not_pressed_twice():
    pressed = []
    emitted = run_handler(pressed.append, [command(), command()])
    assert pressed == ["next"]
    assert emitted[1][1]["errorCode"] == "command_duplicate"


def test_press_failure_acks_rejected():
    def broken(action):
        raise ValueError("bad action")

    emitted = run_handler(broken, [command(action="pause")])
    assert emitted[0][1]["status"] == "rejected"
    assert emitted[0][1]["errorCode"] == "internal_error"
