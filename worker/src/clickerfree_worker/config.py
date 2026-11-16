"""Конфигурация без секретов: идентификатор установки, название, язык, сервер."""

import json
import os
import socket
import sys
import uuid
from dataclasses import asdict, dataclass, fields
from pathlib import Path


@dataclass
class Config:
    install_id: str
    name: str
    lang: str | None = None
    server: str = "http://localhost:3000"
    # Прямой адрес API для Socket.IO при локальной разработке (в продакшене Nginx
    # маршрутизирует /socket.io/ на API, и достаточно server).
    api_server: str | None = None
    # Стабильный eventId первого запуска: повторные запуски не удваивают событие.
    first_run_event_id: str | None = None


def config_dir() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    return base / "ClickerFree"


def load_config(directory: Path | None = None) -> Config:
    directory = directory or config_dir()
    path = directory / "config.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        known = {f.name for f in fields(Config)}
        return Config(**{k: v for k, v in data.items() if k in known})
    cfg = Config(install_id=str(uuid.uuid4()), name=(socket.gethostname() or "Computer")[:64])
    save_config(cfg, directory)
    return cfg


def save_config(cfg: Config, directory: Path | None = None) -> None:
    directory = directory or config_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "config.json").write_text(
        json.dumps(asdict(cfg), ensure_ascii=False, indent=2), encoding="utf-8"
    )
