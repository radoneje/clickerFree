import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { invitationSessions, invitations, type Db } from '@clickerfree/db';
import { hashToken } from '../auth/sessions.js';

export interface InvitationAuth {
  sessionId: string;
  invitationId: string;
  deviceId: string;
  lang: 'ru' | 'en';
  expiresAt: number;
}

export async function createInvitationSession(
  db: Db,
  invitationId: string,
  expiresAt: Date,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(invitationSessions).values({
    invitationId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

export async function findInvitationSession(db: Db, token: string): Promise<InvitationAuth | null> {
  const rows = await db
    .select({
      sessionId: invitationSessions.id,
      invitationId: invitations.id,
      deviceId: invitations.deviceId,
      lang: invitations.lang,
      expiresAt: invitationSessions.expiresAt,
    })
    .from(invitationSessions)
    .innerJoin(invitations, eq(invitationSessions.invitationId, invitations.id))
    .where(
      and(
        eq(invitationSessions.tokenHash, hashToken(token)),
        isNull(invitationSessions.revokedAt),
        gt(invitationSessions.expiresAt, new Date()),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, expiresAt: row.expiresAt.getTime() };
}

export async function revokeInvitationSessions(db: Db, invitationId: string): Promise<void> {
  await db
    .update(invitationSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(invitationSessions.invitationId, invitationId), isNull(invitationSessions.revokedAt)),
    );
}
