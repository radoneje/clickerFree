# worker

Программа для компьютера с презентацией (Python 3.11+). Переключает слайды системными нажатиями клавиш в активном окне: Windows — `keybd_event`, macOS — Quartz CGEvent. Содержимое презентации не читается.

The presentation-computer program (Python 3.11+). Switches slides via system key presses in the active window: Windows — `keybd_event`, macOS — Quartz CGEvent. Presentation content is never read.

## Установка и запуск / Setup and run

```sh
python3 -m venv worker/.venv
worker/.venv/bin/pip install -e './worker[dev]'
worker/.venv/bin/clickerfree-worker --server http://localhost:3000
```

Первый запуск показывает одноразовый код привязки и открывает страницу привязки в браузере. Секреты хранятся в системном хранилище (Keychain / Credential Manager), идентификатор и название — в `config.json` без секретов. Один экземпляр на сессию пользователя (файловая блокировка). Язык сообщений: `--lang`, настройка в конфиге, язык ОС, иначе `ru`.

First run shows a one-time pairing code and opens the pairing page in a browser. Secrets live in the system store (Keychain / Credential Manager); the identifier and name live in `config.json` without secrets. One instance per user session (file lock). Message language: `--lang`, config setting, OS language, otherwise `ru`.

## Тесты / Tests

```sh
npm run test:worker   # pytest из корня / pytest from the root
```

Сборки PyInstaller и подпись — этап 7 плана. `PROTOCOL_VERSION` в `src/clickerfree_worker/__init__.py` должен совпадать с `packages/contracts`.

PyInstaller builds and signing arrive in stage 7. `PROTOCOL_VERSION` in `src/clickerfree_worker/__init__.py` must match `packages/contracts`.
