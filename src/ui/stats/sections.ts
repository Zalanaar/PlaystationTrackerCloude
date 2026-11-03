// D-P5: липкие чипы разделов Статистики. Чистая часть: список разделов и выбор текущего по позициям.
export type StatsSection = { id: string; label: string; selector: string };

/** Порядок = порядок панелей на странице (период и «Всё время»); раздела нет в DOM — чипа нет. */
export const STATS_SECTIONS: readonly StatsSection[] = [
  { id: 'hours', label: 'Часы', selector: '[aria-labelledby="st-hours"], [aria-labelledby^="st-hy-"]' },
  { id: 'genres', label: 'Жанры', selector: '[aria-labelledby="st-genres"]' },
  { id: 'finished', label: 'Пройдено', selector: '[aria-labelledby^="st-fy-"]' },
  { id: 'top', label: 'Топ-10', selector: '.ps-st-panel--top' },
  { id: 'when', label: 'Когда', selector: '[aria-labelledby^="st-pp-"]' },
  { id: 'trophies', label: 'Трофеи', selector: '[aria-labelledby="st-trophies"], [aria-labelledby^="st-ty-"]' },
  { id: 'rare', label: 'Редкие', selector: '.ps-rare' },
  { id: 'activity', label: 'Активность', selector: '.ps-act' },
  { id: 'played', label: 'Игры', selector: '#st-played-sec' },
];

/**
 * Текущий раздел: последний, чей верх уже под линией (низ липкой полосы + запас). Выше первого — первый.
 * Внизу страницы (дальше прокручивать некуда) — последний, иначе короткий последний раздел никогда не станет текущим.
 */
export function currentSection(tops: readonly { id: string; top: number }[], line: number, atBottom: boolean): string | null {
  if (tops.length === 0) return null;
  if (atBottom) return tops[tops.length - 1].id;
  let cur = tops[0].id;
  for (const t of tops) if (t.top <= line) cur = t.id;
  return cur;
}
