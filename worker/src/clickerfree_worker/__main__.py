"""Точка входа воркера: mutex, конфигурация, привязка, проверка версии, соединение."""

import argparse
import sys
import time
import webbrowser

from . import __version__
from .client import build_client
from .config import config_dir, load_config, save_config
from .i18n import detect_lang, t
from .pairing import fetch_result, request_code
from .secrets import get_device_credentials, get_worker_secret, store_device_credentials
from .single_instance import InstanceLock
from .version import fetch_version, is_supported


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="clickerfree-worker")
    parser.add_argument("--server", help="адрес сервиса / service URL")
    parser.add_argument("--api-url", help="прямой адрес API для Socket.IO / direct API URL for Socket.IO")
    parser.add_argument("--lang", choices=["ru", "en"], help="язык сообщений / message language")
    parser.add_argument("--name", help="название компьютера / computer name")
    args = parser.parse_args(argv)

    cfg = load_config()
    if args.server:
        cfg.server = args.server.rstrip("/")
    if args.api_url:
        cfg.api_server = args.api_url.rstrip("/")
    if args.name:
        cfg.name = args.name[:64]
    if args.lang:
        cfg.lang = args.lang
    save_config(cfg)
    lang = detect_lang(args.lang, cfg.lang)

    lock = InstanceLock(config_dir() / "worker.lock")
    if not lock.acquire():
        print(t(lang, "already_running"))
        return 0

    try:
        print(t(lang, "starting", version=__version__))
        try:
            secret = get_worker_secret()
        except Exception as err:  # noqa: BLE001 - системное хранилище может быть недоступно
            print(t(lang, "keyring_unavailable", error=err))
            return 1

        from .pairing import current_arch, current_os

        info = None
        for attempt in range(3):
            try:
                info = fetch_version(cfg.server, current_os(), current_arch())
                break
            except Exception:  # noqa: BLE001 - сеть может быть недоступна
                print(t(lang, "version_check_failed"))
                time.sleep(2**attempt)
        if info is not None and not is_supported(info):
            print(
                t(
                    lang,
                    "version_unsupported",
                    version=__version__,
                    min=info.get("minSupportedVersion", "?"),
                )
            )
            return 1

        device_id, credential = get_device_credentials()
        if not credential or not device_id:
            try:
                code_info = request_code(cfg.server, cfg, secret)
            except Exception as err:  # noqa: BLE001
                print(t(lang, "keyring_unavailable", error=err))
                return 1
            pairing_url = f"{cfg.server}/{lang}/pairing"
            print(t(lang, "pairing_code", code=code_info["code"], url=pairing_url))
            webbrowser.open(pairing_url)
            print(t(lang, "pairing_pending"))
            deadline = time.time() + 300
            while time.time() < deadline:
                result = fetch_result(cfg.server, cfg.install_id, secret)
                if result["status"] == "confirmed":
                    device_id = result["deviceId"]
                    credential = result["credential"]
                    store_device_credentials(device_id, credential)
                    print(t(lang, "pairing_confirmed"))
                    break
                if result["status"] == "expired":
                    print(t(lang, "pairing_expired"))
                    return 1
                time.sleep(2)
            else:
                print(t(lang, "pairing_expired"))
                return 1

        sio, auth = build_client(device_id, credential, lang)
        sio.connect(
            cfg.api_server or cfg.server,
            namespaces=["/worker"],
            auth=auth,
            transports=["websocket"],
        )
        sio.wait()
        return 0
    except KeyboardInterrupt:
        print(t(lang, "goodbye"))
        return 0
    finally:
        lock.release()


if __name__ == "__main__":
    sys.exit(main())
