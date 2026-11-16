import { and, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import {
  controlSessions,
  dailyMetrics,
  downloadEvents,
  usageEvents,
  type Db,
} from '@clickerfree/db';

const IDLE_LIMIT_MS = 15 * 60000;
const RAW_RETENTION_DAYS = 30;
const METRICS_RETENTION_MONTHS = 12;

export async function closeIdleUsageSessions(db: Db, nowMs = Date.now()): Promise<void> {
  await db
    .update(controlSessions)
    .set({ usageEndedAt: sql`${controlSessions.lastCommandAt} + interval '15 minutes'` })
    .where(
      and(
        isNotNull(controlSessions.usageStartedAt),
        isNull(controlSessions.usageEndedAt),
        lt(controlSessions.lastCommandAt, new Date(nowMs - IDLE_LIMIT_MS)),
      ),
    );
}

function dayBounds(day: string): [Date, Date] {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  return [start, end];
}

async function upsertMetric(db: Db, day: string, metric: string, dimension: string, value: number) {
  await db
    .insert(dailyMetrics)
    .values({ day, metric, dimension, value })
    .onConflictDoUpdate({
      target: [dailyMetrics.day, dailyMetrics.metric, dailyMetrics.dimension],
      set: { value },
    });
}

export async function aggregateDay(db: Db, day: string): Promise<void> {
  const [start, end] = dayBounds(day);

  const downloads = await db.execute(sql`
    select os, arch, count(*)::int as n from download_events
    where created_at >= ${start} and created_at < ${end} and not suspicious
    group by os, arch`);
  for (const row of downloads.rows as Array<{ os: string; arch: string; n: number }>) {
    await upsertMetric(db, day, 'downloads', `${row.os}/${row.arch}`, row.n);
  }

  const byVersion = await db.execute(sql`
    select os, arch, coalesce(app_version, 'unknown') as version, count(*)::int as n
    from download_events
    where created_at >= ${start} and created_at < ${end} and not suspicious
    group by os, arch, coalesce(app_version, 'unknown')`);
  for (const row of byVersion.rows as Array<{
    os: string;
    arch: string;
    version: string;
    n: number;
  }>) {
    await upsertMetric(
      db,
      day,
      'downloads_by_version',
      `${row.os}/${row.arch}/${row.version}`,
      row.n,
    );
  }

  const firstRuns = await db.execute(sql`
    select coalesce(action, 'unknown') as dimension, count(*)::int as n from usage_events
    where kind = 'first_run' and created_at >= ${start} and created_at < ${end}
    group by coalesce(action, 'unknown')`);
  for (const row of firstRuns.rows as Array<{ dimension: string; n: number }>) {
    await upsertMetric(db, day, 'first_runs', row.dimension, row.n);
  }

  const pairings = await db.execute(sql`
    select count(*)::int as n from devices where created_at >= ${start} and created_at < ${end}`);
  await upsertMetric(db, day, 'pairings', '', (pairings.rows[0] as { n: number }).n);

  const commands = await db.execute(sql`
    select count(*)::int as n from usage_events
    where kind = 'command' and created_at >= ${start} and created_at < ${end}`);
  await upsertMetric(db, day, 'commands', '', (commands.rows[0] as { n: number }).n);

  const errors = await db.execute(sql`
    select count(*)::int as n from usage_events
    where kind = 'command_rejected' and created_at >= ${start} and created_at < ${end}`);
  await upsertMetric(db, day, 'command_errors', '', (errors.rows[0] as { n: number }).n);

  const sessions = await db.execute(sql`
    select count(*)::int as n,
      coalesce(sum(extract(epoch from (coalesce(usage_ended_at, now()) - usage_started_at))), 0)::int as duration
    from control_sessions
    where usage_started_at >= ${start} and usage_started_at < ${end}`);
  const sessionRow = sessions.rows[0] as { n: number; duration: number };
  await upsertMetric(db, day, 'usage_sessions', '', sessionRow.n);
  await upsertMetric(db, day, 'usage_duration_seconds', '', sessionRow.duration);

  for (const [dimension, days] of [
    ['day', 1],
    ['week', 7],
    ['month', 30],
  ] as const) {
    const windowStart = new Date(end.getTime() - days * 86400000);
    const active = await db.execute(sql`
      select count(distinct d.user_id)::int as n from usage_events e
      join control_sessions cs on cs.id = e.control_session_id
      join devices d on d.id = cs.device_id
      where e.kind = 'command' and e.created_at >= ${windowStart} and e.created_at < ${end}`);
    await upsertMetric(db, day, 'active_users', dimension, (active.rows[0] as { n: number }).n);
  }

  const versions = await db.execute(sql`
    select app_version, count(*)::int as n from devices where revoked_at is null group by app_version`);
  for (const row of versions.rows as Array<{ app_version: string; n: number }>) {
    await upsertMetric(db, day, 'worker_versions', row.app_version, row.n);
  }

  const suspicious = await db.execute(sql`
    select
      (select count(*) from download_events where suspicious and created_at >= ${start} and created_at < ${end})
      + (select count(*) from usage_events where suspicious and created_at >= ${start} and created_at < ${end}) as n`);
  await upsertMetric(
    db,
    day,
    'suspicious_events',
    '',
    Number((suspicious.rows[0] as { n: string }).n),
  );
}

export async function markSuspiciousDownloads(db: Db, day: string): Promise<void> {
  const [start, end] = dayBounds(day);
  await db.execute(sql`
    update download_events set suspicious = true
    where created_at >= ${start} and created_at < ${end}
      and ip_hash in (
        select ip_hash from download_events
        where created_at >= ${start} and created_at < ${end} and ip_hash is not null
        group by ip_hash having count(*) > 100
      )`);
}

export async function cleanupAnalytics(db: Db, nowMs = Date.now()): Promise<void> {
  const rawCutoff = new Date(nowMs - RAW_RETENTION_DAYS * 86400000);
  await db.delete(downloadEvents).where(lt(downloadEvents.createdAt, rawCutoff));
  await db.delete(usageEvents).where(lt(usageEvents.createdAt, rawCutoff));
  const metricsCutoff = new Date(nowMs);
  metricsCutoff.setUTCMonth(metricsCutoff.getUTCMonth() - METRICS_RETENTION_MONTHS);
  await db
    .delete(dailyMetrics)
    .where(lt(dailyMetrics.day, metricsCutoff.toISOString().slice(0, 10)));
}

export async function runAnalyticsCycle(db: Db, nowMs = Date.now()): Promise<void> {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const yesterday = new Date(nowMs - 86400000).toISOString().slice(0, 10);
  await markSuspiciousDownloads(db, today);
  await markSuspiciousDownloads(db, yesterday);
  await closeIdleUsageSessions(db, nowMs);
  await aggregateDay(db, yesterday);
  await aggregateDay(db, today);
  await cleanupAnalytics(db, nowMs);
}

export function startAnalyticsScheduler(db: Db): () => void {
  const run = () => {
    runAnalyticsCycle(db).catch(() => {
      // аналитика не должна ронять API
    });
  };
  run();
  const timer = setInterval(run, 3600000);
  timer.unref();
  return () => clearInterval(timer);
}
