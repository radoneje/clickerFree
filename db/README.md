# db

Схема PostgreSQL и версионированные миграции (Drizzle ORM).

- `src/schema.ts` — все таблицы первой версии; время хранится в UTC (`timestamptz`).
- `migrations/` — SQL-миграции, генерируются `npm run db:generate` из корня и коммитятся.
- Применение: `npm run db:migrate` из корня (читает `DATABASE_URL` из `.env` или окружения).

Тесты создают временные базы через роль с `CREATEDB` (`clickerfree_test` как точка обслуживания) и удаляют их после прогона.
