// П12.3 «Уровень PSN»: очки трофеев и шкала уровней PSN (система с октября 2020). Чистые функции.
// Очки: платина 300, золото 90, серебро 30, бронза 15. Шаг уровня: 1–99 — 60, 100–199 — 90, 200–299 — 450, 300–399 — 900,
// дальше +450 каждую сотню (400–499 — 1350 … 900–998 — 3600). Максимум — 999.
export const TROPHY_POINTS = { platinum: 300, gold: 90, silver: 30, bronze: 15 } as const;
export const MAX_LEVEL = 999;

export type TrophyCounts = { platinum: number; gold: number; silver: number; bronze: number };

export function pointsOf(c: TrophyCounts): number {
  return c.platinum * TROPHY_POINTS.platinum + c.gold * TROPHY_POINTS.gold + c.silver * TROPHY_POINTS.silver + c.bronze * TROPHY_POINTS.bronze;
}

/** Очков, чтобы перейти с уровня `level` на следующий. */
export function stepAt(level: number): number {
  if (level < 100) return 60;
  if (level < 200) return 90;
  if (level < 300) return 450;
  return 900 + 450 * (Math.floor(level / 100) - 3);
}

/** Очков всего, чтобы достичь уровня `level` (уровень 1 — 0 очков). */
export function pointsToReach(level: number): number {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  let sum = 0;
  for (let l = 1; l < L; l++) sum += stepAt(l);
  return sum;
}

/** Уровень и прогресс (0..99, вниз) по очкам. */
export function levelFromPoints(points: number): { level: number; progress: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(points));
  while (level < MAX_LEVEL && left >= stepAt(level)) { left -= stepAt(level); level++; }
  return { level, progress: level >= MAX_LEVEL ? 100 : Math.floor((left / stepAt(level)) * 100) };
}

/** Ближайшая «круглая» цель после текущего уровня: следующая сотня (до 100 — следующие 25). */
export function milestoneAfter(level: number): number | null {
  if (level >= MAX_LEVEL) return null;
  const step = level < 100 ? 25 : 100;
  return Math.min(MAX_LEVEL, (Math.floor(level / step) + 1) * step);
}

/** Дата (МСК «YYYY-MM-DD») через need очков при темпе perDay; null — темпа нет или дольше 5 лет. */
export function etaDate(need: number, perDay: number, now: Date): string | null {
  if (need <= 0) return null;
  if (!(perDay > 0)) return null;
  const days = Math.ceil(need / perDay);
  if (days > 5 * 365) return null;
  return new Date(now.getTime() + days * 86_400_000 + 3 * 3600_000).toISOString().slice(0, 10);
}
