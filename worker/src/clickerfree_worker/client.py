"""Socket.IO-клиент воркера: команды, дедупликация, подтверждения."""

import time
from collections.abc import Callable

import socketio

from . import PROTOCOL_VERSION, __version__
from .commands import CommandGate
from .i18n import t
from .keys import press
from .pairing import current_arch, current_os


def make_command_handler(
    gate: CommandGate,
    emit: Callable[[str, dict], None],
    lang: str,
    press_fn: Callable[[str], None] = press,
) -> Callable[[dict], None]:
    def handle(data: dict) -> None:
        command_id = data.get("commandId", "")
        action = data.get("action", "")
        expires_at = int(data.get("expiresAt", 0))
        verdict = gate.accept(command_id, expires_at, int(time.time() * 1000))
        if verdict == "expired":
            emit("control:ack", {"commandId": command_id, "status": "rejected", "errorCode": "command_expired"})
            return
        if verdict == "duplicate":
            emit("control:ack", {"commandId": command_id, "status": "rejected", "errorCode": "command_duplicate"})
            return
        try:
            press_fn(action)
        except (ValueError, RuntimeError):
            emit("control:ack", {"commandId": command_id, "status": "rejected", "errorCode": "internal_error"})
            return
        # Подтверждение означает выполнение системного вызова, не смену слайда.
        emit("control:ack", {"commandId": command_id, "status": "executed"})

    return handle


def build_client(
    device_id: str,
    credential: str,
    lang: str,
    log: Callable[[str], None] = print,
) -> tuple[socketio.Client, dict]:
    sio = socketio.Client(
        reconnection=True,
        reconnection_delay=1,
        reconnection_delay_max=30,
    )
    gate = CommandGate()

    auth = {
        "deviceId": device_id,
        "credential": credential,
        "appVersion": __version__,
        "os": current_os(),
        "arch": current_arch(),
        "protocolVersion": PROTOCOL_VERSION,
    }

    @sio.on("connect", namespace="/worker")
    def on_connect() -> None:
        log(t(lang, "connected"))

    @sio.on("disconnect", namespace="/worker")
    def on_disconnect() -> None:
        log(t(lang, "disconnected"))

    @sio.on("control:command", namespace="/worker")
    def on_command(data: dict) -> None:
        make_command_handler(gate, lambda event, payload: sio.emit(event, payload, namespace="/worker"), lang)(data)

    return sio, auth
