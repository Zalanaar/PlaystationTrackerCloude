import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { requireOwner } from '@/server/auth/require-user';
import { loadHealthOverview } from '@/server/health/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Только owner (контракт F35.1). К PSN не обращается, секреты в ответ не попадают.
export async function GET(req: Request) {
  const a = await requireOwner(req);
  if (!a.ok) return a.response;
  try {
    return ok(await loadHealthOverview(getDb(), process.env));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
