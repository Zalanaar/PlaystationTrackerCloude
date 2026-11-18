import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { closeShowcase, getShowcaseState, openShowcase, showcasePath } from '@/server/showcase/showcase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// П14.3 Публичная витрина (контракт «П14.3»): GET — открыта ли; POST — открыть / выпустить новую ссылку (ключ в ответе один раз); DELETE — закрыть.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getShowcaseState(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    const r = await openShowcase(getDb(), a.user.id, new Date());
    const res = ok({ open: true, createdAt: r.createdAt, path: showcasePath(r.token) });
    for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
    return res;
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function DELETE(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await closeShowcase(getDb(), a.user.id);
    return ok({ open: false, createdAt: null });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
