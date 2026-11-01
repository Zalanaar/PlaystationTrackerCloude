import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { getMultiuserEnv, getPsnEnv } from '@/server/env';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { addProfile, getProfileDto, listProfiles } from '@/server/auth/profiles';
import { buildCheck } from '@/server/auth/psn-access';
import { setActiveProfileCookie } from '@/server/auth/profile-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store' };
const body = z.object({ onlineId: z.string().max(64), activate: z.boolean().optional() }).strict();

// Профили PSN входа сессии (Фаза 41, контракт 41.3). loginId только из сессии, чужие профили не попадают никогда.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const mu = getMultiuserEnv();
    return ok(await listProfiles(getDb(), a.user.loginId, a.user.id, { maxProfiles: mu.maxProfilesPerLogin, maxUsers: mu.maxUsers }));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let input: z.infer<typeof body>;
  try {
    const r = body.safeParse(await req.json());
    if (!r.success) return fail(400, 'invalid_request', 'Некорректный запрос.');
    input = r.data;
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const env = getPsnEnv();
  if (!env) return fail(500, 'config_error', 'Не заданы настройки PSN.');
  const mu = getMultiuserEnv();
  try {
    const db = getDb();
    const mode = process.env.PSN_NEW_USER_MODE?.trim() === 'friend' ? 'friend' : 'public';
    const r = await addProfile(db, {
      loginId: a.user.loginId,
      onlineId: input.onlineId,
      check: buildCheck(db, env),
      limits: { maxProfiles: mu.maxProfilesPerLogin, maxUsers: mu.maxUsers },
      mode,
      ownerOnlineId: env.targetOnlineId,
    });
    switch (r.kind) {
      case 'created':
      case 'restored': {
        const profile = await getProfileDto(db, a.user.loginId, r.profileId);
        if (!profile) return fail(503, 'db_unavailable', 'База данных недоступна.');
        const activate = input.activate !== false;
        const res = NextResponse.json(
          r.kind === 'restored' ? { ok: true, data: { profile, restored: true, activeProfileId: activate ? profile.id : a.user.id } } : { ok: true, data: { profile, activeProfileId: activate ? profile.id : a.user.id } },
          { status: r.kind === 'restored' ? 200 : 201, headers: NO_STORE },
        );
        if (activate && !(await setActiveProfileCookie(res, req, profile.id))) return fail(401, 'unauthorized', 'Требуется вход.');
        return res;
      }
      case 'invalid':
        return fail(400, 'invalid_request', 'Ник PSN: 3–16 символов, латиница, цифры, дефис и подчёркивание, начинается с буквы.');
      case 'login_inactive':
        return fail(401, 'unauthorized', 'Требуется вход.');
      case 'profile_limit':
        return fail(409, 'profile_limit', `К одному входу можно привязать не больше ${mu.maxProfilesPerLogin} профилей PSN.`, { limit: mu.maxProfilesPerLogin });
      case 'user_limit':
        return fail(409, 'user_limit', 'Достигнут общий лимит профилей.');
      case 'taken':
        return fail(409, 'psn_id_taken', 'Этот профиль PSN уже подключён.');
      case 'rate_limited':
        return fail(429, 'rate_limited', 'Подождите немного и повторите.', { retryAfterSec: r.retryAfterSec }, { 'Retry-After': String(r.retryAfterSec) });
      case 'not_found':
        return fail(422, 'psn_not_found', 'Профиль PSN с таким ником не найден. Проверьте ник.');
      case 'private':
        return fail(422, 'psn_private', 'Профиль PSN закрыт. Откройте в настройках приватности игры и трофеи для всех и повторите.');
      case 'unavailable':
        return fail(503, 'psn_unavailable', 'PSN сейчас недоступен. Попробуйте позже.');
    }
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
