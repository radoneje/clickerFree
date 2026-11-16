import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { sessions, users, type Db } from '@clickerfree/db';

export interface SessionAuth {
  sessionId: string;
  userId: string;
  role: 'user' | 'admin';
  siteLang: 'ru' | 'en';
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: string, ttlDays: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlDays * 86400000),
  });
  return token;
}

export async function findSession(db: Db, token: string): Promise<SessionAuth | null> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      role: users.role,
      siteLang: users.siteLang,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeOtherSessions(
  db: Db,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId), isNull(sessions.revokedAt)),
    );
}
