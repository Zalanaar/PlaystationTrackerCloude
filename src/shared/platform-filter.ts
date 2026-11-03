/**
 * F4: фильтр по платформе в Коллекции и Бэклоге. Чистые функции, без env/БД/сети.
 * Игра PS5 с привязанной версией PS4 (дубль) попадает в оба фильтра: платформа считается по самой игре и её версиям.
 * Выбор запоминается в cookie (сервер читает его для первого рендера, без сдвига); параметр URL сильнее cookie.
 */
export const PLATFORM_KEYS = ['ps5', 'ps4', 'pc'] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];
export type PlatformCounts = Record<PlatformKey, number>;

export const PLATFORM_KEY_LABEL: Record<PlatformKey, string> = { ps5: 'PS5', ps4: 'PS4', pc: 'PC' };
/** Ключ → games.category (PSN). */
export const PLATFORM_CATEGORY: Record<PlatformKey, string> = { ps5: 'ps5_native_game', ps4: 'ps4_game', pc: 'pspc_game' };

export const PLATFORM_COOKIE = 'ps-platform';
/** Значение параметра URL «все платформы»: перекрывает запомненный выбор. */
export const PLATFORM_ALL = 'all';

export function parsePlatform(v: string | null | undefined): PlatformKey | null {
  return v && (PLATFORM_KEYS as readonly string[]).includes(v) ? (v as PlatformKey) : null;
}

/** Строка для document.cookie: выбор на год; null удаляет cookie. */
export function platformCookie(v: PlatformKey | null): string {
  return v ? `${PLATFORM_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax` : `${PLATFORM_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** Минимум игр, чтобы платформа получила вариант: одинокая PC-игра чипа не даёт. */
export const PLATFORM_MIN_GAMES = 2;

export type PlatformOptionItem = { id: PlatformKey; label: string; n: number };

/**
 * Варианты фильтра: платформы, где игр не меньше PLATFORM_MIN_GAMES (выбранная показывается всегда).
 * Меньше двух вариантов и ничего не выбрано: фильтр не нужен, пустой список.
 */
export function platformChoices(counts: PlatformCounts | null | undefined, selected: PlatformKey | null): PlatformOptionItem[] {
  if (!counts) return selected ? [{ id: selected, label: PLATFORM_KEY_LABEL[selected], n: 0 }] : [];
  const opts = PLATFORM_KEYS.filter((k) => counts[k] >= PLATFORM_MIN_GAMES || k === selected).map((k) => ({ id: k, label: PLATFORM_KEY_LABEL[k], n: counts[k] }));
  return opts.length < 2 && !selected ? [] : opts;
}
