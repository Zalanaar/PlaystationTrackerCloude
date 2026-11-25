// Липкие чипы разделов Статистики: 5 логических групп. Старые ?sec= остаются и ведут в нужную группу/панель.
export type StatsSection = { id: string; label: string; selector: string };

export const STATS_SECTIONS: readonly StatsSection[] = [
  { id: 'time', label: 'Время', selector: '[data-st-group="time"]' },
  { id: 'games', label: 'Игры', selector: '[data-st-group="games"]' },
  { id: 'trophies', label: 'Трофеи', selector: '[data-st-group="trophies"]' },
  { id: 'ratings', label: 'Оценки', selector: '[data-st-group="ratings"]' },
  { id: 'activity', label: 'Активность', selector: '[data-st-group="activity"]' },
];

/** Прежние id чипов и ?sec=: группа для подсветки и селектор, куда скроллить (панель, если она есть). */
export const STATS_SEC_ALIASES: Readonly<Record<string, { group: string; selector: string }>> = {
  time: { group: 'time', selector: '[data-st-group="time"]' },
  hours: { group: 'time', selector: '[aria-labelledby="st-hours"], [aria-labelledby^="st-hy-"]' },
  when: { group: 'time', selector: '[aria-labelledby^="st-pp-"]' },
  games: { group: 'games', selector: '[data-st-group="games"]' },
  genres: { group: 'games', selector: '[aria-labelledby="st-genres"]' },
  finished: { group: 'games', selector: '[aria-labelledby^="st-fy-"]' },
  top: { group: 'games', selector: '.ps-st-panel--top' },
  played: { group: 'games', selector: '#st-played-sec' },
  trophies: { group: 'trophies', selector: '[data-st-group="trophies"]' },
  ach: { group: 'trophies', selector: '.ps-ach' },
  rare: { group: 'trophies', selector: '.ps-rare' },
  ratings: { group: 'ratings', selector: '[data-testid="ratings"]' },
  activity: { group: 'activity', selector: '[data-st-group="activity"]' },
};

export function resolveStatsSec(raw: string | null | undefined): { group: string; selector: string } | null {
  if (!raw) return null;
  return STATS_SEC_ALIASES[raw] ?? null;
}

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
