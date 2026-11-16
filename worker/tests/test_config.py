import json
import uuid

from clickerfree_worker.config import Config, load_config, save_config


def test_first_load_creates_persistent_identity(tmp_path):
    cfg = load_config(tmp_path)
    uuid.UUID(cfg.install_id)
    assert cfg.name
    again = load_config(tmp_path)
    assert again.install_id == cfg.install_id


def test_config_file_contains_no_secrets(tmp_path):
    cfg = load_config(tmp_path)
    cfg.lang = "en"
    save_config(cfg, tmp_path)
    data = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert set(data) == {"install_id", "name", "lang", "server", "api_server", "first_run_event_id"}
    assert load_config(tmp_path).lang == "en"


def test_unknown_fields_are_ignored(tmp_path):
    (tmp_path / "config.json").write_text(
        json.dumps({"install_id": "x", "name": "PC", "credential": "leak"}), encoding="utf-8"
    )
    cfg = load_config(tmp_path)
    assert cfg.install_id == "x"
    assert not hasattr(cfg, "credential")


def test_defaults():
    cfg = Config(install_id="x", name="PC")
    assert cfg.server == "http://localhost:3000"
    assert cfg.lang is None
