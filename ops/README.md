# ops

Конфигурации эксплуатации:

- `ecosystem.config.cjs` — PM2: `clickerfree-api` (один экземпляр, без cluster) и `clickerfree-web` (активируется на этапах 2–3). Ротация журналов — модулем `pm2-logrotate`, автозапуск — `pm2 save` + `pm2 startup`.
- `nginx.conf.example` — пример для существующего Nginx: loopback-upstream 3000/3001, WebSocket-заголовки, лимиты запросов до базы, журналы без query-параметров.

Реальные пути, порты и имена сертификатов фиксируются после осмотра сервера (этап 9). Секреты загружаются через `ENV_FILE` (`/etc/clickerfree/production.env`), не через Git.
