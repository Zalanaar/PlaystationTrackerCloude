import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getAchievements } from '@/server/achievements/achievements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П13.1 (контракт «П13. Достижения»): GET — 12 личных вех: цель, значение, получено ли и когда.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return okRevalidated(req, await getAchievements(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
