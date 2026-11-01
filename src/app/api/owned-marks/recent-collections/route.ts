import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { recentCollections } from '@/server/owned/marks';
import { parseRecentLimit } from '@/server/owned/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Недавно выбранные сборники (приоритет в списке выбора). Контракт Фазы 40, 40.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const l = parseRecentLimit(new URL(req.url).searchParams.get('limit'));
  if (!l.ok) return fail(400, 'invalid_request', l.message);
  try {
    return ok({ collections: await recentCollections(getDb(), a.user.id, l.value) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
