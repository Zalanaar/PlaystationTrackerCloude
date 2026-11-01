import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { fail, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { findSwitchTarget } from '@/server/auth/profiles';
import { setActiveProfileCookie } from '@/server/auth/profile-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ profileId: z.number().int().positive().max(2147483647) }).strict();

// Переключение активного профиля (41.3). Идемпотентно. Чужой, архивный и несуществующий профиль: одинаковый 404.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let profileId: number;
  try {
    const r = body.safeParse(await req.json());
    if (!r.success) return fail(400, 'invalid_request', 'Некорректный запрос.');
    profileId = r.data.profileId;
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  try {
    const profile = await findSwitchTarget(getDb(), a.user.loginId, profileId);
    if (!profile) return fail(404, 'not_found', 'Профиль не найден.');
    const res = NextResponse.json({ ok: true, data: { activeProfileId: profile.id, profile } }, { headers: { 'Cache-Control': 'no-store' } });
    if (!(await setActiveProfileCookie(res, req, profile.id))) return fail(401, 'unauthorized', 'Требуется вход.');
    return res;
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
