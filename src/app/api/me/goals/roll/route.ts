import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { applyPlannerRoll, parseRoll } from '@/server/goals/month-goals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function parseBody(req: Request): Promise<unknown> {
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try { return await req.json(); } catch { return null; }
}

// Перенос или закрытие итогов месяца / цели года после календарного перехода.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const parsed = parseRoll(await parseBody(req));
  if (!parsed.ok) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok(await applyPlannerRoll(getDb(), a.user.id, new Date(), parsed.value.kind, parsed.value.action));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
