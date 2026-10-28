// Прогноз платины (контракт 14.2). Чистые функции: агрегат по сету -> прогноз игры -> топ «ближе всего к платине».
import type { GameTrophyItem, PlatinumForecast } from './types';

export const NEAR_PLATINUM_LIMIT = 5;

type NonPlat = 'gold' | 'silver' | 'bronze';

/** Сводка одного трофейного сета игры (по таблице trophies). */
export type SetAgg = {
  setId: number;
  platinumDefined: number;
  platinumEarned: number;
  /** earned_rate платины сета или null. */
  platinumEarnedRate: number | null;
  defined: Record<NonPlat, number>;
  earned: Record<NonPlat, number>;
  remainingHidden: number;
  /** Сумма/число/минимум earned_rate неполученных неплатиновых. */
  rateSum: number;
  rateCount: number;
  rateMin: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function emptySetAgg(setId: number): SetAgg {
  return {
    setId,
    platinumDefined: 0,
    platinumEarned: 0,
    platinumEarnedRate: null,
    defined: { gold: 0, silver: 0, bronze: 0 },
    earned: { gold: 0, silver: 0, bronze: 0 },
    remainingHidden: 0,
    rateSum: 0,
    rateCount: 0,
    rateMin: null,
  };
}

/** Сводки сетов из списка трофеев окна игры (12.5), порядок по setId. */
export function setAggsFromTrophies(list: readonly Pick<GameTrophyItem, 'setId' | 'type' | 'earned' | 'hidden' | 'earnedRate'>[]): SetAgg[] {
  const by = new Map<number, SetAgg>();
  for (const t of list) {
    const a = by.get(t.setId) ?? emptySetAgg(t.setId);
    by.set(t.setId, a);
    if (t.type === 'platinum') {
      a.platinumDefined++;
      if (t.earned) a.platinumEarned++;
      if (t.earnedRate !== null) a.platinumEarnedRate = t.earnedRate;
      continue;
    }
    a.defined[t.type]++;
    if (t.earned) {
      a.earned[t.type]++;
      continue;
    }
    if (t.hidden) a.remainingHidden++;
    if (t.earnedRate !== null) {
      a.rateSum += t.earnedRate;
      a.rateCount++;
      a.rateMin = a.rateMin === null ? t.earnedRate : Math.min(a.rateMin, t.earnedRate);
    }
  }
  return [...by.values()].sort((x, y) => x.setId - y.setId);
}

const sumNP = (r: Record<NonPlat, number>) => r.gold + r.silver + r.bronze;
/** Точное отношение для сравнения (required = 0 даёт 0). */
const ratio = (a: SetAgg) => {
  const req = sumNP(a.defined);
  return req === 0 ? 0 : sumNP(a.earned) / req;
};

/**
 * Прогноз игры по сводкам её сетов. null: нет сетов, нет платины ни в одном, или платина получена хоть в одном.
 * Выбирается сет с неполученной платиной и максимальным прогрессом, ничья: меньший setId.
 */
export function platinumForecast(sets: readonly SetAgg[]): PlatinumForecast | null {
  if (sets.some((s) => s.platinumEarned > 0)) return null;
  const candidates = sets.filter((s) => s.platinumDefined > 0);
  if (!candidates.length) return null;
  const best = candidates.slice().sort((a, b) => ratio(b) - ratio(a) || a.setId - b.setId)[0];
  const required = sumNP(best.defined);
  const earned = sumNP(best.earned);
  const remaining = {
    gold: best.defined.gold - best.earned.gold,
    silver: best.defined.silver - best.earned.silver,
    bronze: best.defined.bronze - best.earned.bronze,
    total: required - earned,
  };
  return {
    setId: best.setId,
    required,
    earned,
    progress: required === 0 ? 0 : Math.min(100, Math.floor((earned / required) * 100)),
    remaining,
    remainingHidden: best.remainingHidden,
    avgEarnedRate: best.rateCount ? round2(best.rateSum / best.rateCount) : null,
    minEarnedRate: best.rateMin === null ? null : round2(best.rateMin),
    ratesKnown: best.rateCount,
    platinumEarnedRate: best.platinumEarnedRate === null ? null : round2(best.platinumEarnedRate),
  };
}

export type NearPlatinumCandidate = { gameId: number; title: string; forecast: PlatinumForecast };

/**
 * Топ «ближе всего к платине» (14.2). Вход: прогнозы уже отобранных игр (видимые, не dropped).
 * Отбор earned > 0; порядок: точный прогресс desc, remaining.total asc, lower(title), id.
 */
export function rankNearPlatinum(items: readonly NearPlatinumCandidate[], limit = NEAR_PLATINUM_LIMIT): NearPlatinumCandidate[] {
  const exact = (f: PlatinumForecast) => (f.required === 0 ? 0 : f.earned / f.required);
  return items
    .filter((i) => i.forecast.earned > 0)
    .slice()
    .sort((a, b) => {
      const d = exact(b.forecast) - exact(a.forecast) || a.forecast.remaining.total - b.forecast.remaining.total;
      if (d) return d;
      const ta = a.title.toLowerCase();
      const tb = b.title.toLowerCase();
      return ta < tb ? -1 : ta > tb ? 1 : a.gameId - b.gameId;
    })
    .slice(0, limit);
}
