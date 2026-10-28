// Нормализация жанров PSN и словарь RU (контракт 1.9, design-system 4.7).
// Чистый модуль: без env, БД и серверных импортов. Его можно импортировать из src/ui (CLAUDE.md, правила кода).
export const GENRE_LABELS_RU = {
  ACTION: 'Экшен',
  ADVENTURE: 'Приключения',
  ROLE_PLAYING_GAMES: 'Ролевые',
  SHOOTER: 'Шутеры',
  HORROR: 'Хоррор',
  RACING: 'Гонки',
  SIMULATION: 'Симуляторы',
  FIGHTING: 'Файтинги',
  ARCADE: 'Аркады',
  MUSIC_RHYTHM: 'Музыка и ритм',
  CASUAL: 'Казуальные',
  STRATEGY: 'Стратегии',
  PUZZLE: 'Головоломки',
  FAMILY: 'Семейные',
  PARTY: 'Вечеринка',
  OTHER: 'Другое',
} as const;

export type GenreKey = keyof typeof GENRE_LABELS_RU;

const ALIASES: Record<string, GenreKey> = { SIMULATOR: 'SIMULATION', UNIQUE: 'OTHER' };

/** Один сырой жанр PSN -> ключ. Неизвестное значение = OTHER (без падения). */
export function normalizeGenre(raw: string): GenreKey {
  const k = raw.trim().toUpperCase().replace(/[\s/]+/g, '_');
  if (k in ALIASES) return ALIASES[k];
  return k in GENRE_LABELS_RU ? (k as GenreKey) : 'OTHER';
}

/** Массив жанров -> уникальные ключи в исходном порядке. Пустой вход = ['OTHER']. */
export function normalizeGenres(raw: readonly string[] | null | undefined): GenreKey[] {
  const out: GenreKey[] = [];
  for (const g of raw ?? []) {
    const k = normalizeGenre(g);
    if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : ['OTHER'];
}

/** Эффективные жанры игры: genres_override ?? normalize(psn_genres). */
export function effectiveGenres(psnGenres: readonly string[] | null, override: readonly string[] | null): GenreKey[] {
  return normalizeGenres(override ?? psnGenres);
}

/** Служебное значение фильтра `genres` (16.4): у игры нет жанров вообще. Не входит в GenreKey. */
export const GENRE_NONE = 'none';
export type GenreFilterKey = GenreKey | typeof GENRE_NONE;

/** true, если у игры нет ни одного жанра (override ?? psn пусто). Такая игра по 1.9 показывается как OTHER, но фильтр `none` отличает её от реального «Другое». */
export function hasNoGenres(psnGenres: readonly string[] | null, override: readonly string[] | null): boolean {
  return !(override ?? psnGenres ?? []).some((g) => g.trim() !== '');
}
