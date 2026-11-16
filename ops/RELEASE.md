# Выпуск релизов воркеров / Worker release process

Первая версия: обновление ручное, во время выступления не устанавливается. Сервис учитывает **запросы ссылок**, а не завершённые скачивания; массовая раздача идёт через GitHub Releases, не через API.
First version: updates are manual and never installed during a presentation. The service counts **link requests**, not completed downloads; bulk distribution goes through GitHub Releases, not the API.

## Ключ подписи / Signing key

- Манифесты подписываются ed25519. Приватный ключ `ops/keys/release-ed25519.private.pem` **вне Git** (gitignored), хранится у издателя в защищённом месте. Публичный ключ встраивается в воркеры (`worker/src/clickerfree_worker/release.py`, `worker-windows/src/Release.cs`).
- Генерация: `node scripts/release-keygen.mjs`. Подпись: `node scripts/sign-manifest.mjs <manifest.json>`.
- Ротация ключа требует пересборки воркеров с новым публичным ключом.
- Manifests are ed25519-signed. The private key stays outside Git; the public key is embedded in both workers. Key rotation requires rebuilding workers.

## Сборки / Builds

macOS (arm64/x64, на соответствующей машине):

```sh
worker/.venv/bin/pip install -e './worker[dev]'
worker/.venv/bin/pyinstaller --onefile --name clickerfree-worker-macos-arm64 \
  --paths worker/src --hidden-import keyring.backends.macOS --hidden-import Quartz \
  --distpath ops/dist worker/launcher.py
shasum -a 256 ops/dist/clickerfree-worker-macos-arm64
```

Windows (x64, на Windows-машине с .NET SDK 10):

```sh
dotnet test worker-windows/tests/ClickerFree.Worker.Tests.csproj
dotnet publish worker-windows/src/ClickerFree.Worker.csproj -c Release -r win-x64 \
  --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
certutil -hashfile worker-windows\src\bin\Release\net10.0\win-x64\publish\clickerfree-worker.exe SHA256
```

## Подпись исполняемых файлов / Executable signing

- macOS: `codesign --options runtime --sign "Developer ID Application: …"` и нотаризация `xcrun notarytool submit … --wait` + `xcrun stapler staple`. Требуется Apple Developer аккаунт.
- Windows: `signtool sign /fd SHA256 /tr <timestamp URL> /td SHA256 /a <exe>`. Требуется сертификат подписи кода.
- Не предлагать пользователю отключение системной защиты как штатный сценарий.
- macOS: codesign + notarization (Apple Developer account required). Windows: signtool (code-signing certificate required). Never instruct users to disable system protection.

## Манифест и публикация / Manifest and publishing

1. Манифест: `{version, os, arch, protocolVersion, publishedAt, files: [{name, url, sha256}]}`; `url` — адрес файла в GitHub Releases; `sha256` — хэш файла. Подписать: `node scripts/sign-manifest.mjs`.
2. Загрузить бинарь и манифест в GitHub Releases вручную.
3. Зарегистрировать релиз в админке `/admin/releases` (или `POST /api/admin/releases`): `downloadUrl` и `manifestUrl` на GitHub (https), `sha256`, `descriptionKey` (ru/en в словаре), `minSupportedVersion`. Хосты скачиваний ограничены `ALLOWED_DOWNLOAD_HOSTS`.
4. Нажать «Опубликовать» — релиз становится доступен через `/api/worker/version` и `/api/download/:os/:arch`. Повышение `minSupportedVersion` — отдельное действие администратора с записью в журнал.
5. Воркер проверяет подпись манифеста встроенным публичным ключом и предлагает обновление; SHA-256 файла сверяется при установке. Неподписанный манифест игнорируется.

## Локальная проверка / Local verification

```sh
python3 -m http.server 8088 --directory ops/dist   # раздача собранных файлов
# в .env: ALLOWED_DOWNLOAD_HOSTS=localhost (или github.com,localhost)
node scripts/e2e-servers.mjs                        # временные серверы и БД
```

Регистрация релиза с `manifestUrl=http://localhost:8088/manifest-….json`, затем `GET /api/download/macos/arm64` → 302 и событие; воркер печатает предложение обновления для подписанного манифеста с более новой версией.
