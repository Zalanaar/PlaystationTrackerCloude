import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok, originAllowed } from '@/server/http';
import { clearGoal, getGoal, putGoal, SettingsRequiredError } from '@/server/roadmap/db';
import { parseGoalBody } from '@/server/roadmap/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Цель года в штуках и прогноз по темпу. Контракт 17.3a.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok({ goal: await getGoal(getDb(), a.user.id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseGoalBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ goal: await putGoal(getDb(), a.user.id, p.value) });
  } catch (e) {
    if (e instanceof SettingsRequiredError) return fail(409, 'settings_required', 'Сначала задай год и часы в неделю.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function DELETE(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await clearGoal(getDb(), a.user.id);
    return ok({ goal: null });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
