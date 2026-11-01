import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { allPartsFailed, getInbox } from '@/server/inbox/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Полоса «С прошлого визита». Контракт Фазы 28.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const r = await getInbox(getDb(), a.user.id);
    if (allPartsFailed(r)) return fail(503, 'db_unavailable', 'База данных недоступна.');
    return ok(r);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
