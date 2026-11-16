import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/migrate.js';
import { createScratchDatabase, type ScratchDatabase } from './helpers.js';

const EXPECTED_TABLES = [
  'users',
  'oauth_accounts',
  'sessions',
  'devices',
  'device_credentials',
  'pairing_requests',
  'invitations',
  'control_sessions',
  'timers',
  'worker_releases',
  'download_events',
  'usage_events',
  'daily_metrics',
  'audit_events',
  'rate_limit_buckets',
];

describe('migrations', () => {
  let scratch: ScratchDatabase;
  let pool: Pool;

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    pool = new Pool({ connectionString: scratch.url, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await scratch.drop();
  });

  it('creates all planned tables on an empty database', async () => {
    const result = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = result.rows.map((row: { table_name: string }) => row.table_name);
    for (const table of EXPECTED_TABLES) {
      expect(names, `table ${table}`).toContain(table);
    }
  });

  it('is idempotent on re-run', async () => {
    await expect(migrate(scratch.url)).resolves.toBeUndefined();
  });

  it('enforces unique oauth identity per provider', async () => {
    const user = await pool.query(`insert into users (site_lang) values ('ru') returning id`);
    const userId = user.rows[0].id as string;
    await pool.query(
      `insert into oauth_accounts (user_id, provider, provider_user_id) values ($1, 'vk', '42')`,
      [userId],
    );
    await expect(
      pool.query(
        `insert into oauth_accounts (user_id, provider, provider_user_id) values ($1, 'vk', '42')`,
        [userId],
      ),
    ).rejects.toThrow();
    await pool.query(
      `insert into oauth_accounts (user_id, provider, provider_user_id) values ($1, 'yandex', '42')`,
      [userId],
    );
  });

  it('allows only one active controller per device', async () => {
    const user = await pool.query(`insert into users default values returning id`);
    const device = await pool.query(
      `insert into devices (user_id, install_id, name, os, arch, app_version, protocol_version)
       values ($1, gen_random_uuid(), 'Test PC', 'windows', 'x64', '1.0.0', 1) returning id`,
      [user.rows[0].id],
    );
    const deviceId = device.rows[0].id as string;
    await pool.query(`insert into control_sessions (device_id, is_controller) values ($1, true)`, [
      deviceId,
    ]);
    await expect(
      pool.query(`insert into control_sessions (device_id, is_controller) values ($1, true)`, [
        deviceId,
      ]),
    ).rejects.toThrow();
    await pool.query(`insert into control_sessions (device_id, is_controller) values ($1, false)`, [
      deviceId,
    ]);
  });

  it('deduplicates analytics events by event_id', async () => {
    const eventId = '0b9c6a2e-1f3d-4e5a-9b8c-7d6e5f4a3b2c';
    await pool.query(`insert into usage_events (event_id, kind) values ($1, 'command')`, [eventId]);
    await expect(
      pool.query(`insert into usage_events (event_id, kind) values ($1, 'command')`, [eventId]),
    ).rejects.toThrow();
  });
});
