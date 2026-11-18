import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { compareProfiles } from '@/server/profiles/compare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = (v: string | null) => (v !== null && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null);

// П14.1 (контракт «П14.1. Сравнение профилей»): GET ?a=&b= — два разных профиля входа сессии; чужой/архивный — 404.
export async function GET(req: Request) {
  const u = await requireUser(req);
  if (!u.ok) return u.response;
  const q = new URL(req.url).searchParams;
  const a = id(q.get('a'));
  const b = id(q.get('b'));
  if (a === null || b === null || a === b) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    const r = await compareProfiles(getDb(), u.user.loginId, a, b);
    if (!r) return fail(404, 'not_found', 'Профиль не найден.');
    return ok(r, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
