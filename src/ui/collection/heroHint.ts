/**
 * Подсказка «есть ли игры в „Играю“» для первого рендера (CLS).
 * Скелет hero (≈320 px) без игр «Играю» исчезал после загрузки и сдвигал всю страницу.
 * Клиент запоминает последнее значение в cookie, сервер читает его и не рисует скелет зря.
 */
export const HERO_HINT_COOKIE = 'ps-hero';

/** Значение cookie → подсказка; нет или мусор → undefined (скелет как раньше). */
export function parseHeroHint(v: string | undefined): boolean | undefined {
  if (v === '1') return true;
  if (v === '0') return false;
  return undefined;
}

/** Строка для document.cookie: на год, весь сайт. */
export function heroHintCookie(hasPlaying: boolean): string {
  return `${HERO_HINT_COOKIE}=${hasPlaying ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Ждём ли hero «Играю». Сводка загружена: решает её счётчик.
 * Иначе подсказка из cookie; без подсказки ждём (прежнее поведение).
 */
export function expectHero(summaryPlaying: number | null, hint: boolean | undefined): boolean {
  if (summaryPlaying !== null) return summaryPlaying > 0;
  return hint !== false;
}
