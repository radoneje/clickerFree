"""Системные нажатия клавиш macOS через Quartz CGEvent.

Windows обслуживается отдельным нативным воркером (worker-windows, C#/.NET).
"""

import sys


class UnsupportedOsError(RuntimeError):
    pass


_MAC_KEYCODES = {"previous": 123, "next": 124}


def press(action: str) -> None:
    if action not in ("previous", "next"):
        raise ValueError(f"unknown action: {action}")
    if sys.platform != "darwin":
        raise UnsupportedOsError("this worker supports macOS only; use the native Windows worker")
    from Quartz import (  # type: ignore[import-not-found]
        CGEventCreateKeyboardEvent,
        CGEventPost,
        kCGHIDEventTap,
    )

    keycode = _MAC_KEYCODES[action]
    for down in (True, False):
        event = CGEventCreateKeyboardEvent(None, keycode, down)
        CGEventPost(kCGHIDEventTap, event)
