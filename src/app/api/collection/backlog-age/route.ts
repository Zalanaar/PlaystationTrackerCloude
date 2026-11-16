import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getBacklogAge } from '@/server/collection/backlog-age';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П12.4 (контракт «П12. Возраст бэклога»): GET — с какого момента каждая игра в бэклоге, медиана, «дольше года», самая давняя.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return okRevalidated(req, await getBacklogAge(getDb(), a.user.id, new Date()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
