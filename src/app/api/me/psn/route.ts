import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getPsnEnv } from '@/server/env';
import { fail, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { buildCheck, getPsnState, setPsnAccess } from '@/server/auth/psn-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store' };

// Состояние ника PSN и онбординга пользователя сессии. Контракт 22.13.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const state = await getPsnState(getDb(), a.user.id);
    if (!state) return fail(401, 'unauthorized', 'Требуется вход.');
    return NextResponse.json({ ok: true, data: state }, { headers: NO_STORE });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// Ввод ника PSN и проверка доступа к профилю техническим аккаунтом. Контракт 22.13.
export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (b.onlineId !== undefined && typeof b.onlineId !== 'string') return fail(400, 'invalid_request', 'Ник PSN должен быть строкой.');
  const env = getPsnEnv();
  if (!env) return fail(500, 'config_error', 'Не заданы настройки PSN.');
  try {
    const db = getDb();
    const r = await setPsnAccess(db, a.user.id, b.onlineId, buildCheck(db, env));
    switch (r.kind) {
      case 'ok':
        return NextResponse.json({ ok: true, data: r.state }, { headers: NO_STORE });
      case 'invalid':
        return fail(400, 'invalid_request', 'Ник PSN: 3–16 символов, латиница, цифры, дефис и подчёркивание, начинается с буквы.');
      case 'taken':
        return fail(409, 'psn_id_taken', 'Этот ник PSN уже используется другим пользователем.');
      case 'locked':
        return fail(409, 'psn_account_locked', 'В коллекции уже есть игры другого аккаунта PSN. Сменить аккаунт нельзя, обратитесь к владельцу.');
      case 'rate_limited':
        return fail(429, 'rate_limited', 'Проверка уже выполнялась. Подождите немного и повторите.', { retryAfterSec: r.retryAfterSec }, { 'Retry-After': String(r.retryAfterSec) });
      case 'not_found':
        return fail(422, 'psn_not_found', 'Профиль PSN с таким ником не найден. Проверьте ник.');
      case 'private':
        return fail(422, 'psn_private', 'Профиль PSN закрыт. Откройте в настройках приватности игры и трофеи для всех и повторите.');
      case 'friend_required':
        return fail(422, 'psn_friend_required', 'Нужна дружба с техническим аккаунтом. Примите заявку в друзья и проверьте снова.');
      case 'unavailable':
        return fail(503, 'psn_unavailable', 'PSN сейчас недоступен. Попробуйте позже.');
    }
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
