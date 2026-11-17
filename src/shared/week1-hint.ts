/**
 * П13.4: подсказка «показывать ли „Первую неделю“» для первого рендера главной (CLS), как `ps-hero`.
 * Клиент запоминает последний ответ GET /api/me/checklist; онбординг ставит «1» перед переходом на главную.
 */
export const WEEK1_HINT_COOKIE = 'ps-week1';

export function parseWeek1Hint(v: string | undefined): boolean | undefined {
  if (v === '1') return true;
  if (v === '0') return false;
  return undefined;
}

/** Строка для document.cookie: 8 дней (неделя и запас), весь сайт. */
export function week1HintCookie(show: boolean): string {
  return `${WEEK1_HINT_COOKIE}=${show ? '1' : '0'}; path=/; max-age=${8 * 86400}; samesite=lax`;
}
