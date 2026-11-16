import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getLevel } from '@/server/trophies/level-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П12.3 (контракт «П12. Уровень PSN»): GET — уровень PSN, очки, прирост за 30/365 дней, прогноз следующего уровня.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return okRevalidated(req, await getLevel(getDb(), a.user.id, new Date()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
