// «Когда ты играешь» (контракт 26.3): трофеи по часам суток и дням недели по МСК (UTC+3 без DST). Чистые функции, без БД.
import type { PlayPattern } from './types';

export const PLAY_PATTERN_LABEL = 'по времени трофеев';
/** Порог «достаточно данных»: меньше трофеев паттерн был бы шумом. */
export const PLAY_PATTERN_MIN_TOTAL = 20;

const MSK_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** Ячейка: час МСК 0..23, день недели 0 = понедельник .. 6 = воскресенье, число трофеев. */
export type PatternCell = { hour: number; weekday: number; n: number };

/** Момент UTC -> час и день недели по МСК. */
export function mskHourWeekday(at: Date): { hour: number; weekday: number } {
  const t = at.getTime() + MSK_OFFSET_MS;
  const hour = Math.floor((((t % DAY_MS) + DAY_MS) % DAY_MS) / 3600000);
  // 1970-01-01 был четвергом (пн = 0 -> четверг = 3)
  const days = Math.floor(t / DAY_MS);
  const weekday = (((days + 3) % 7) + 7) % 7;
  return { hour, weekday };
}

/** Из SQL: isodow 1..7 (пн..вс) -> индекс 0..6. */
export const isoDowToIndex = (isodow: number): number => isodow - 1;

function peak(values: readonly number[]): number | null {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (v > 0 && (best === null || v > values[best])) best = i;
  });
  return best;
}

/** Собирает блок из ячеек. Ячейки вне диапазона и n <= 0 игнорируются. */
export function buildPlayPattern(cells: readonly PatternCell[]): PlayPattern {
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  let total = 0;
  for (const c of cells) {
    if (c.n <= 0 || c.hour < 0 || c.hour > 23 || c.weekday < 0 || c.weekday > 6) continue;
    byHour[c.hour] += c.n;
    byWeekday[c.weekday] += c.n;
    total += c.n;
  }
  return { byHour, byWeekday, total, peakHour: peak(byHour), peakWeekday: peak(byWeekday), label: PLAY_PATTERN_LABEL, hasData: total >= PLAY_PATTERN_MIN_TOTAL };
}

/** То же по списку моментов получения трофеев (для тестов и малых наборов). */
export function playPatternFromDates(dates: readonly Date[]): PlayPattern {
  return buildPlayPattern(dates.map((d) => ({ ...mskHourWeekday(d), n: 1 })));
}
