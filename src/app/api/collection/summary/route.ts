import { getDb } from '@/db';
import { getCollectionSummary } from '@/server/collection/query';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Шапка статистики, «Играю сейчас», «Продолжить». Контракт 9.3.
export async function GET() {
  try {
    return ok(await getCollectionSummary(getDb()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
