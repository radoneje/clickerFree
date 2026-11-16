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

## Разработка / Development

Требуется Node.js LTS (не ниже 24) и npm. Python-инструменты воркера появятся на этапе 4.
Requires Node.js LTS (24+) and npm. Python worker tooling arrives in stage 4.

```sh
npm ci             # зависимости из lock-файла / install from lockfile
npm run check      # сборка, линт, типы, словари, формат / build, lint, types, locales, format
npm test           # тесты Vitest / Vitest tests
npm run build      # сборка рабочих пространств / build workspaces
npm run db:migrate # миграции БД (заглушка до этапа 1) / DB migrations (stub until stage 1)
npm run format     # форматирование Prettier / Prettier formatting
```

Рабочие пространства: `apps/web`, `apps/api`, `packages/contracts`, `packages/locales`; каталоги `worker/`, `db/`, `ops/` заполняются по [плану реализации](docs/implementation-plan.md).
Workspaces: `apps/web`, `apps/api`, `packages/contracts`, `packages/locales`; `worker/`, `db/`, `ops/` are filled in per the [implementation plan](docs/implementation-plan.md).

Секреты: скопируйте `.env.example` в `.env` и заполните; `.env` не коммитится.
Secrets: copy `.env.example` to `.env` and fill it in; never commit `.env`.

