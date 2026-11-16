// PM2: два процесса, API строго в одном экземпляре (без cluster) до появления
// распределённой координации соединений и лимитов. Пути фиксируются после осмотра сервера.
module.exports = {
  apps: [
    {
      name: 'clickerfree-api',
      script: 'apps/api/dist/server.js',
      cwd: '/srv/clickerfree',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      kill_timeout: 10000,
      time: true,
      env_production: {
        NODE_ENV: 'production',
        ENV_FILE: '/etc/clickerfree/production.env',
      },
    },
    {
      // Процесс активируется после появления Next.js (этапы 2–3).
      name: 'clickerfree-web',
      script: 'apps/web/node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/srv/clickerfree',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      kill_timeout: 10000,
      time: true,
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '127.0.0.1',
      },
    },
  ],
};
