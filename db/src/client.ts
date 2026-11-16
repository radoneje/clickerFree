import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export function createPool(
  connectionString: string,
  options: { connectionTimeoutMillis?: number; max?: number } = {},
): Pool {
  return new Pool({
    connectionString,
    max: options.max ?? 5,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
  });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
