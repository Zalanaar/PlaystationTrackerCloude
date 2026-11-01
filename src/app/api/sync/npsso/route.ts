import { getDb } from '@/db';
import { requireOwner } from '@/server/auth/require-user';
import { markLoginSuccess, reserveLoginAttempt } from '@/server/auth/attempts';
import { hashIp } from '@/server/auth/password';
import { getPsnEnv, getSessionSecret } from '@/server/env';
import { clientIp, fail, ok, originAllowed } from '@/server/http';
import { PsnError } from '@/server/psn/errors';
import { normalizeNpsso, pasteNpsso } from '@/server/psn/npsso';
import { getTokenInfo } from '@/server/psn/token-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Вставка NPSSO с сайта (контракт 27.1). NPSSO только из тела запроса, дальше не уходит ни в БД, ни в логи, ни в ответ:
// в ответ идут только фиксированные тексты, исключения не пробрасываются и не логируются.
export async function POST(req: Request) {
  const a = await requireOwner(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const env = getPsnEnv();
  const secret = getSessionSecret();
  if (!env || !secret) return fail(500, 'config_error', 'Не заданы настройки PSN.');

  let raw: unknown;
  try {
    raw = (await req.json())?.npsso;
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const npsso = normalizeNpsso(raw);
  if (!npsso) return fail(400, 'invalid_request', 'Неверный формат NPSSO: нужна строка из 64 символов.', { field: 'npsso' });

  try {
    const db = getDb();
    const reservation = await reserveLoginAttempt(hashIp(clientIp(req), secret), 'npsso');
    if (reservation.limited) {
      return fail(
        429,
        'rate_limited',
        'Слишком много попыток. Попробуйте позже.',
        { retryAfterSeconds: reservation.retryAfterSeconds },
        { 'Retry-After': String(reservation.retryAfterSeconds) },
      );
    }
    const now = new Date();
    try {
      const r = await pasteNpsso(db, { npsso, encryptionKey: env.encryptionKey, userId: a.user.id, now });
      if (r.kind === 'rejected') return fail(422, 'npsso_invalid', 'PSN не принял NPSSO. Получите новый и вставьте снова.');
      await markLoginSuccess(reservation.id);
      const t = await getTokenInfo(db, now);
      return ok({ accepted: true, refreshExpiresAt: r.refreshExpiresAt ? r.refreshExpiresAt.toISOString() : null, token: t?.info ?? null });
    } catch (e) {
      if (e instanceof PsnError) return fail(503, 'psn_unavailable', 'PSN сейчас недоступен или ограничивает запросы. Попробуйте позже.');
      throw e;
    }
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
