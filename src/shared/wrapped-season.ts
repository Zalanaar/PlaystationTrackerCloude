// Сезон «Итоги года» (П8.4): общий для баннеров (клиент), подсказки первого экрана (сервер) и строки сводки в Telegram.
// Граница дня по МСК: с 1 декабря 00:00 МСК итоги текущего года (предварительные до конца года), весь январь итоги прошлого года.

const MSK_OFFSET_MS = 3 * 3_600_000;

export type WrappedSeason = { year: number; preliminary: boolean };

/** Итоги какого года предлагаем сейчас; вне декабря и января (или без времени) null. */
export function wrappedSeason(nowMs: number): WrappedSeason | null {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return null;
  const x = new Date(nowMs + MSK_OFFSET_MS);
  const m = x.getUTCMonth() + 1;
  const y = x.getUTCFullYear();
  if (m === 12) return { year: y, preliminary: true };
  if (m === 1) return { year: y - 1, preliminary: false };
  return null;
}

/** Cookie «баннер Итогов этого года закрыт»: сервер не рисует баннер на главной, и после гидрации он не пропадает (CLS 0). */
export const WRAPPED_HIDDEN_COOKIE = 'ps-wbh';

export function wrappedHiddenCookie(year: number): string {
  return `${WRAPPED_HIDDEN_COOKIE}=${year}; path=/; max-age=31536000; samesite=lax`;
}

/** Баннер для серверного рендера главной: сезон, и cookie не закрывает этот год; иначе null. */
export function ssrWrappedSeason(cookie: string | undefined, nowMs: number = Date.now()): WrappedSeason | null {
  const s = wrappedSeason(nowMs);
  if (!s) return null;
  return cookie === String(s.year) ? null : s;
}
