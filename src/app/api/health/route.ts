import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const { syncRuns } = schema;

// Запуски kind='hltb' (контракт 16.7) в индикации синка не участвуют.
const notHltb = ne(syncRuns.kind, 'hltb');

// Доступ только под сессией (проверяет src/proxy.ts). К PSN не обращается.
export async function GET() {
  try {
    const db = getDb();
    const [last] = await db.select().from(syncRuns).where(notHltb).orderBy(desc(syncRuns.startedAt)).limit(1);
    const [lastDone] = await db.select().from(syncRuns).where(and(notHltb, ne(syncRuns.status, 'running'))).orderBy(desc(syncRuns.startedAt)).limit(1);
    const [lastSuccess] = await db
      .select({ finishedAt: syncRuns.finishedAt })
      .from(syncRuns)
      .where(and(notHltb, eq(syncRuns.status, 'success')))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);

    const authFailed = lastDone?.errorReason === 'auth_expired' || lastDone?.errorReason === 'npsso_invalid';
    const psnAuth = !lastDone ? 'unknown' : authFailed ? 'auth_expired' : 'ok';
    const degraded = psnAuth === 'auth_expired' || last?.status === 'failed';

    return ok({
      status: degraded ? 'degraded' : 'ok',
      time: new Date().toISOString(),
      db: { ok: true },
      sync: {
        lastRun: last
          ? {
              id: last.id,
              kind: last.kind,
              status: last.status,
              errorReason: last.errorReason,
              startedAt: last.startedAt.toISOString(),
              finishedAt: last.finishedAt ? last.finishedAt.toISOString() : null,
              snapshotDate: last.snapshotDate,
            }
          : null,
        lastSuccessAt: lastSuccess?.finishedAt ? lastSuccess.finishedAt.toISOString() : null,
        psnAuth,
      },
    });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
