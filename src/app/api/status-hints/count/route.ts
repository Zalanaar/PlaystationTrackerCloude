import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { countStatusHints } from '@/server/sync/status-hints-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Счётчик подсказок для бейджа. Контракт 28.5.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok({ count: await countStatusHints(getDb(), a.user.id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
