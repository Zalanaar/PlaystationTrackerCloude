import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getOnThisDay } from '@/server/stats/day-query';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П11.2 «В этот день»: сегодняшний день МСК в прошлые годы. Контракт «П11. В этот день».
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getOnThisDay(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
