/** Запоминаем, раскрыт ли блок «Сегодня» на главной (SSR читает cookie — без CLS при загрузке). По умолчанию свёрнут. */
export const TODAY_OPEN_COOKIE = 'ps-today-open';

export function parseTodayOpen(v: string | undefined): boolean {
  return v === '1';
}

/** Строка для document.cookie: год, весь сайт. */
export function todayOpenCookie(open: boolean): string {
  return `${TODAY_OPEN_COOKIE}=${open ? '1' : '0'}; path=/; max-age=${400 * 86400}; samesite=lax`;
}
