"""Дедупликация команд и проверка срока действия (TTL назначает сервер)."""

import time
from collections import OrderedDict


class CommandGate:
    def __init__(self, capacity: int = 1000) -> None:
        self.capacity = capacity
        self._seen: OrderedDict[str, None] = OrderedDict()

    def accept(self, command_id: str, expires_at_ms: int, now_ms: int | None = None) -> str:
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        if expires_at_ms <= now:
            return "expired"
        if command_id in self._seen:
            return "duplicate"
        self._seen[command_id] = None
        if len(self._seen) > self.capacity:
            self._seen.popitem(last=False)
        return "ok"
