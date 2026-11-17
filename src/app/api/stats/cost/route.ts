import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getCostStats } from '@/server/prices/prices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П13.3 (контракт «П13.3»): GET — стоимость часа по играм с ценой покупки: итог, выгодные, дорогие, лежат без дела.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return okRevalidated(req, await getCostStats(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
