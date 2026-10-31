import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getSyncStatus } from '@/server/sync/status';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// К PSN не обращается. Контракт 8.4.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getSyncStatus(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
