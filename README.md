# ClickerFree

Бесплатный интернет-сервис для дистанционного переключения презентаций на Windows и macOS. Публичный сайт, личный кабинет, мобильный пульт и программа для компьютера с презентацией.

## Статус

Проект находится на этапе проектирования. Описанные возможности и команды развёртывания — требования к будущей реализации, а не уже работающие функции.

## Документация

- [Требования и сценарии](docs/requirements.md)
- [Архитектура и технологии](docs/architecture.md)
- [Защита от злоупотреблений](docs/security.md)
- [Развёртывание и сопровождение](docs/deployment.md)
- [План реализации](docs/implementation-plan.md)

## Зафиксированные решения

- Интерфейсы на русском и английском; язык пульта независим от языка кабинета.
- При генерации ссылки спикеру владелец выбирает язык пульта.
- Все пользовательские сообщения создаются сразу на двух языках.
- Вход через VK ID и Яндекс ID, без локальных паролей в первой версии.
- Обновление сервера вручную: GitHub → SSH → `git pull` → сборка → PM2.
- Используется существующий Nginx; Docker и Caddy не используются.
- Безопасность, ограничения нагрузки и статистика входят в первую версию.
- Воркер Windows — нативный C#/.NET (self-contained exe, без Python); воркер macOS — Python.

## Разработка / Development

Требуется Node.js LTS (не ниже 24) и npm. Воркер macOS — Python (`worker/`), воркер Windows — C#/.NET (`worker-windows/`).
Requires Node.js LTS (24+) and npm. The macOS worker is Python (`worker/`); the Windows worker is C#/.NET (`worker-windows/`).

```sh
npm ci             # зависимости из lock-файла / install from lockfile
npm run check      # сборка, линт, типы, словари, формат / build, lint, types, locales, format
npm test           # тесты Vitest / Vitest tests
npm run build      # сборка рабочих пространств / build workspaces
npm run db:generate # генерация миграций из схемы / generate migrations from schema
npm run db:migrate # применение миграций / apply migrations
npm run format     # форматирование Prettier / Prettier formatting
npm run test:e2e   # E2E Playwright (нужен Chromium: npx playwright install chromium) / Playwright E2E (requires Chromium)
npm run test:worker # тесты воркера (нужен venv, см. worker/README.md) / worker tests (venv required, see worker/README.md)
```

Локальный запуск (два терминала):
Local run (two terminals):

```sh
npm ci && npm run db:migrate && npm run build
env -u SESSION_SECRET npm run start -w @clickerfree/api  # терминал 1, порт 3001 / terminal 1, port 3001
npm run dev -w @clickerfree/web                          # терминал 2, порт 3000 / terminal 2, port 3000
```

Откройте http://localhost:3000 — главная, вход, кабинет и настройки. Кнопка «Тестовый вход» работает при `OAUTH_DEV_ENABLED=true`. `env -u SESSION_SECRET` нужен, только если оболочка экспортирует устаревший `SESSION_SECRET`, перекрывающий `.env`.
Open http://localhost:3000 — landing, sign-in, dashboard, and settings. The "Test sign-in" button works with `OAUTH_DEV_ENABLED=true`. `env -u SESSION_SECRET` is only needed if your shell exports a stale `SESSION_SECRET` that overrides `.env`.

Воркер локально: `worker/.venv/bin/clickerfree-worker --server http://localhost:3000 --api-url http://127.0.0.1:3001` (Next.js не проксирует WebSocket, поэтому Socket.IO идёт напрямую в API; в продакшене это делает Nginx и `--api-url` не нужен). Смоук всего цикла: `node scripts/worker-smoke.mjs`.
Worker locally: `worker/.venv/bin/clickerfree-worker --server http://localhost:3000 --api-url http://127.0.0.1:3001` (Next.js does not proxy WebSocket, so Socket.IO goes straight to the API; in production Nginx handles it and `--api-url` is unnecessary). Full-cycle smoke: `node scripts/worker-smoke.mjs`.

Windows-воркер (нативный C#/.NET 10, `worker-windows/`): сборка и тесты на Windows-машине — `dotnet test worker-windows/tests/ClickerFree.Worker.Tests.csproj`, публикация — `dotnet publish worker-windows/src/ClickerFree.Worker.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true`. Секреты по умолчанию в Credential Manager (работает в интерактивной сессии); для headless/SSH есть явный opt-in `CLICKERFREE_SECRET_FILE`. Кросс-машинный смоук: `node scripts/windows-worker-smoke.mjs` (нужен SSH-доступ к Windows-машине).
Windows worker (native C#/.NET 10, `worker-windows/`): build and test on a Windows machine — `dotnet test worker-windows/tests/ClickerFree.Worker.Tests.csproj`, publish — `dotnet publish worker-windows/src/ClickerFree.Worker.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true`. Secrets default to Credential Manager (works in an interactive session); headless/SSH has an explicit `CLICKERFREE_SECRET_FILE` opt-in. Cross-machine smoke: `node scripts/windows-worker-smoke.mjs` (requires SSH access to a Windows machine).

Пульт: кабинет → «Открыть пульт» у устройства. Крупные кнопки «Назад»/«Вперёд», стрелки клавиатуры, таймер (5/10/15 мин, стоп), статус связи; при потере связи управление блокируется. Браузер берёт адрес Socket.IO из `/api/config` (`SOCKET_PUBLIC_URL`; пусто = тот же origin за Nginx). Один управляющий сеанс на устройство, передача — по запросу с подтверждением владельца (пульт или кабинет), до 5 пультов на устройство. Команды: TTL 2 с, дедупликация на воркере, лимит 5/с со всплеском 10.
Remote: dashboard → "Open remote" on a device. Large Back/Forward buttons, keyboard arrows, timer (5/10/15 min, stop), connection status; control is blocked when offline. The browser gets the Socket.IO URL from `/api/config` (`SOCKET_PUBLIC_URL`; empty = same origin behind Nginx). One control session per device; transfer on request with owner approval (remote or dashboard); up to 5 remotes per device. Commands: 2 s TTL, worker-side dedup, 5/s limit with burst 10.

Для тестов и `db:migrate` нужен PostgreSQL и `DATABASE_URL` в `.env`. Тесты создают временные базы, поэтому роль должна иметь `CREATEDB`.
Tests and `db:migrate` require PostgreSQL and `DATABASE_URL` in `.env`. Tests create scratch databases, so the role needs `CREATEDB`.

Рабочие пространства: `apps/web`, `apps/api`, `packages/contracts`, `packages/locales`; каталоги `worker/`, `db/`, `ops/` заполняются по [плану реализации](docs/implementation-plan.md).
Workspaces: `apps/web`, `apps/api`, `packages/contracts`, `packages/locales`; `worker/`, `db/`, `ops/` are filled in per the [implementation plan](docs/implementation-plan.md).

Секреты: скопируйте `.env.example` в `.env` и заполните; `.env` не коммитится.
Secrets: copy `.env.example` to `.env` and fill it in; never commit `.env`.

Переменные окружения имеют приоритет над `.env`. Вход для разработки: при `OAUTH_DEV_ENABLED=true` (вне продакшена) доступен тестовый провайдер — `/api/auth/dev/start?dev_user=alice`. Реальные VK ID и Яндекс ID включаются заполнением `VK_ID_CLIENT_*` и `YANDEX_ID_CLIENT_*` в `.env`.
Environment variables take precedence over `.env`. Development sign-in: with `OAUTH_DEV_ENABLED=true` (non-production) a test provider is available at `/api/auth/dev/start?dev_user=alice`. Real VK ID and Yandex ID are enabled by filling `VK_ID_CLIENT_*` and `YANDEX_ID_CLIENT_*` in `.env`.

