import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const langEnum = pgEnum('lang', ['ru', 'en']);
export const roleEnum = pgEnum('user_role', ['user', 'admin']);
export const providerEnum = pgEnum('oauth_provider', ['vk', 'yandex', 'dev']);
export const osEnum = pgEnum('worker_os', ['windows', 'macos']);
export const archEnum = pgEnum('worker_arch', ['x64', 'arm64']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: roleEnum('role').notNull().default('user'),
  siteLang: langEnum('site_lang').notNull().default('ru'),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: providerEnum('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex('oauth_accounts_provider_identity').on(t.provider, t.providerUserId),
    uniqueIndex('oauth_accounts_user_provider').on(t.userId, t.provider),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('sessions_token_hash').on(t.tokenHash),
    index('sessions_user_id').on(t.userId),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installId: uuid('install_id').notNull(),
    name: text('name').notNull(),
    os: osEnum('os').notNull(),
    arch: archEnum('arch').notNull(),
    appVersion: text('app_version').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('devices_install_id').on(t.installId), index('devices_user_id').on(t.userId)],
);

export const deviceCredentials = pgTable(
  'device_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    credentialHash: text('credential_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('device_credentials_hash').on(t.credentialHash),
    index('device_credentials_device_id').on(t.deviceId),
  ],
);

export const pairingRequests = pgTable(
  'pairing_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installId: uuid('install_id').notNull(),
    codeHash: text('code_hash').notNull(),
    workerSecretHash: text('worker_secret_hash').notNull(),
    name: text('name').notNull(),
    os: osEnum('os').notNull(),
    arch: archEnum('arch').notNull(),
    appVersion: text('app_version').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [index('pairing_requests_install_id').on(t.installId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    lang: langEnum('lang').notNull(),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('invitations_token_hash').on(t.tokenHash),
    index('invitations_device_id').on(t.deviceId),
  ],
);

export const invitationSessions = pgTable(
  'invitation_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => invitations.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('invitation_sessions_token_hash').on(t.tokenHash),
    index('invitation_sessions_invitation_id').on(t.invitationId),
  ],
);

export const controlSessions = pgTable(
  'control_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    invitationId: uuid('invitation_id').references(() => invitations.id, { onDelete: 'set null' }),
    isController: boolean('is_controller').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastCommandAt: timestamp('last_command_at', { withTimezone: true }),
    usageStartedAt: timestamp('usage_started_at', { withTimezone: true }),
    usageEndedAt: timestamp('usage_ended_at', { withTimezone: true }),
  },
  (t) => [
    index('control_sessions_device_id').on(t.deviceId),
    uniqueIndex('control_sessions_one_controller')
      .on(t.deviceId)
      .where(sql`ended_at is null and is_controller = true`),
  ],
);

export const timers = pgTable('timers', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' })
    .unique(),
  endAt: timestamp('end_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workerReleases = pgTable(
  'worker_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: text('version').notNull(),
    os: osEnum('os').notNull(),
    arch: archEnum('arch').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    downloadUrl: text('download_url').notNull(),
    manifestUrl: text('manifest_url'),
    sha256: text('sha256').notNull(),
    descriptionKey: text('description_key').notNull(),
    minSupportedVersion: text('min_supported_version').notNull().default('0.0.0'),
    isAvailable: boolean('is_available').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [uniqueIndex('worker_releases_os_arch_version').on(t.os, t.arch, t.version)],
);

export const downloadEvents = pgTable(
  'download_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    os: osEnum('os').notNull(),
    arch: archEnum('arch').notNull(),
    appVersion: text('app_version'),
    installId: uuid('install_id'),
    ipHash: text('ip_hash'),
    suspicious: boolean('suspicious').notNull().default(false),
    createdAt,
  },
  (t) => [
    uniqueIndex('download_events_event_id').on(t.eventId),
    index('download_events_created_at').on(t.createdAt),
  ],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    controlSessionId: uuid('control_session_id').references(() => controlSessions.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    action: text('action'),
    processingMs: integer('processing_ms'),
    installId: uuid('install_id'),
    suspicious: boolean('suspicious').notNull().default(false),
    createdAt,
  },
  (t) => [
    uniqueIndex('usage_events_event_id').on(t.eventId),
    index('usage_events_created_at').on(t.createdAt),
    index('usage_events_device_id').on(t.deviceId),
  ],
);

export const dailyMetrics = pgTable(
  'daily_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    day: date('day').notNull(),
    metric: text('metric').notNull(),
    dimension: text('dimension').notNull().default(''),
    value: bigint('value', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('daily_metrics_day_metric_dimension').on(t.day, t.metric, t.dimension)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    details: jsonb('details'),
    createdAt,
  },
  (t) => [index('audit_events_created_at').on(t.createdAt)],
);

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
