# worker-windows

Нативный воркер для Windows: C# / .NET 10 (LTS), self-contained single-file exe, без Python и без установки runtime. Переключает слайды через Win32 `SendInput` (VK_LEFT/VK_RIGHT) в активном окне; содержимое презентации не читается.

Native Windows worker: C# / .NET 10 (LTS), self-contained single-file exe, no Python and no runtime install. Switches slides via Win32 `SendInput` (VK_LEFT/VK_RIGHT) in the active window; presentation content is never read.

- Один экземпляр на сессию: именованный mutex `Local\ClickerFree.Worker`. / One instance per session: named mutex.
- Секреты: Windows Credential Manager (`CredWrite`/`CredRead`). Конфиг без секретов: `%APPDATA%\ClickerFree\config.json`. / Secrets in Credential Manager; secret-free config in `%APPDATA%`.
- Сообщения ru/en; язык: `--lang`, конфиг, язык ОС, иначе `ru`. / ru/en messages; language: `--lang`, config, OS language, else `ru`.
- Socket.IO: WebSocket, переподключение 1–30 с; дедупликация `commandId` и TTL команд. / WebSocket, 1–30 s reconnect; commandId dedup and TTL.

## Сборка и тесты / Build and tests

Сборка выполняется на Windows-машине (требуется .NET SDK 10):
Build runs on a Windows machine (.NET SDK 10 required):

```sh
dotnet test worker-windows/tests/ClickerFree.Worker.Tests.csproj
dotnet publish worker-windows/src/ClickerFree.Worker.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

Запуск: `clickerfree-worker.exe --server https://<домен>` (в продакшене Nginx маршрутизирует `/socket.io/`; при локальной разработке добавьте `--api-url http://127.0.0.1:3001`).
Run: `clickerfree-worker.exe --server https://<domain>` (Nginx routes `/socket.io/` in production; for local development add `--api-url http://127.0.0.1:3001`).

`Service.ProtocolVersion` должен совпадать с `PROTOCOL_VERSION` в `packages/contracts`. Подпись exe и выпуск — этап 7 плана.
`Service.ProtocolVersion` must match `PROTOCOL_VERSION` in `packages/contracts`. exe signing and release arrive in stage 7.
