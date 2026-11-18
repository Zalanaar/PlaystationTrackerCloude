import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { feedPath, getFeedState, issueFeed, revokeFeed } from '@/server/roadmap/calendar-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// Подписка на календарь релизов: GET — включена ли; POST — выпустить/перевыпустить ссылку (ключ в ответе один раз); DELETE — отключить.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getFeedState(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    const r = await issueFeed(getDb(), a.user.id, new Date());
    const res = ok({ active: true, createdAt: r.createdAt, path: feedPath(r.token) });
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
    await revokeFeed(getDb(), a.user.id);
    return ok({ active: false, createdAt: null });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
