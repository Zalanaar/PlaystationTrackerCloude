import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getHunts } from '@/server/hunts/hunts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — текущая охота: игра за платиной и закреплённые трофеи (полученные уже сняты).
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getHunts(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
