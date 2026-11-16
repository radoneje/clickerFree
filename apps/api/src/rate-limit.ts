import { sql } from 'drizzle-orm';
import type { Db } from '@clickerfree/db';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Фиксированное окно одним атомарным upsert: счётчики переживают перезапуск API.
export async function takeRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = await db.execute(sql`
    insert into rate_limit_buckets as b (key, window_start, count, updated_at)
    values (${key}, now(), 1, now())
    on conflict (key) do update set
      count = case
        when b.window_start <= now() - make_interval(secs => ${windowSeconds}) then 1
        else b.count + 1
      end,
      window_start = case
        when b.window_start <= now() - make_interval(secs => ${windowSeconds}) then now()
        else b.window_start
      end,
      updated_at = now()
    returning b.count,
      extract(epoch from (b.window_start + make_interval(secs => ${windowSeconds}) - now())) as retry_after
  `);
  const row = result.rows[0] as { count: number; retry_after: string } | undefined;
  if (!row) throw new Error('rate limit upsert returned no row');
  return {
    allowed: row.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retry_after))),
  };
}
