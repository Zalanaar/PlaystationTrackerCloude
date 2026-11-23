import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getMonthGoals, parseGoals, saveMonthGoals } from '@/server/goals/month-goals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function parseBody(req: Request): Promise<unknown> {
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try { return await req.json(); } catch { return null; }
}

// Цели месяца на главной: GET — текущий месяц МСК, цели и прогресс; PUT — сохранить или снять (все поля null).
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getMonthGoals(getDb(), a.user.id, new Date()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const parsed = parseGoals(await parseBody(req));
  if (!parsed.ok) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok(await saveMonthGoals(getDb(), a.user.id, new Date(), parsed.value));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
