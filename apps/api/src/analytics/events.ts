import { and, eq, isNull } from 'drizzle-orm';
import { controlSessions, usageEvents, type Db } from '@clickerfree/db';

// Ошибка аналитики не должна блокировать переключение слайдов.
export async function recordCommandEvent(
  db: Db,
  opts: {
    deviceId: string;
    controlSessionId: string;
    commandId: string;
    action: string;
    processingMs: number;
    rejected?: boolean;
    errorCode?: string;
  },
): Promise<void> {
  try {
    await db
      .insert(usageEvents)
      .values({
        eventId: opts.commandId,
        deviceId: opts.deviceId,
        controlSessionId: opts.controlSessionId,
        kind: opts.rejected ? 'command_rejected' : 'command',
        action: opts.rejected ? (opts.errorCode ?? 'unknown') : opts.action,
        processingMs: opts.processingMs,
      })
      .onConflictDoNothing();
  } catch {
    // намеренно тихо: управление важнее аналитики
  }
}

export async function markUsageStarted(db: Db, controlSessionId: string): Promise<void> {
  try {
    await db
      .update(controlSessions)
      .set({ usageStartedAt: new Date() })
      .where(and(eq(controlSessions.id, controlSessionId), isNull(controlSessions.usageStartedAt)));
  } catch {
    // аналитика не блокирует управление
  }
}

export async function endUsageSession(db: Db, controlSessionId: string): Promise<void> {
  try {
    await db
      .update(controlSessions)
      .set({ usageEndedAt: new Date() })
      .where(and(eq(controlSessions.id, controlSessionId), isNull(controlSessions.usageEndedAt)));
  } catch {
    // аналитика не блокирует управление
  }
}
