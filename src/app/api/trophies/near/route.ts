import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getNearPlatinumList } from '@/server/trophies/near';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Пакет 6, п. 9 (контракт §24.1): GET — все игры с прогрессом к платине, порядок как у «Ближе всего к платине».
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return okRevalidated(req, await getNearPlatinumList(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
