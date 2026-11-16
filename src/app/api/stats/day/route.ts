import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getDay } from '@/server/stats/day-query';
import { parseDayDate } from '@/server/stats/day';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П11.1 «Дневник дня»: игры, трофеи и завершения дня МСК + соседние игровые дни. Контракт «П11. Дневник дня».
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const date = parseDayDate(new URL(req.url).searchParams.get('date'));
  if (!date) return fail(400, 'invalid_request', 'Некорректная дата.');
  try {
    return ok(await getDay(getDb(), a.user.id, date));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
