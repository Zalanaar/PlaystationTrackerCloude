import { getDb } from '@/db';
import { getCollectionSummary } from '@/server/collection/query';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Шапка статистики, «Играю сейчас», «Продолжить». Контракт 9.3.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return okRevalidated(req, await getCollectionSummary(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
