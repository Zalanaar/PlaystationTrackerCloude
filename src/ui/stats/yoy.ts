// П11.3 «Год к году»: сравнение периода с тем же периодом прошлого года по ответу /api/stats за прошлый год. Чистые функции.
import type { StatsResponse } from '@/server/stats/types';
import type { Selection, Today } from './model';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

export type YoyItem = { key: 'hours' | 'completed' | 'dropped' | 'platinum'; label: string; cur: number; prev: number; delta: number };
export type Yoy = { title: string; note: string | null; items: YoyItem[] };

/** Сумма по месяцам [from..to] (1..12): часы, платины, пройдено и брошено. hours = null, если ни в одном месяце нет данных. */
function sumMonths(d: StatsResponse, year: number, from: number, to: number) {
  let hours: number | null = null;
  for (let m = from; m <= to; m++) {
    const v = d.hours.byMonth[m - 1];
    if (v !== null && v !== undefined) hours = (hours ?? 0) + v;
  }
  let platinum = 0;
  for (const t of d.trophies.byMonth) if (t.month >= from && t.month <= to) platinum += t.platinum;
  let completed = 0;
  let dropped = 0;
  for (const g of d.played.groups) {
    if (g.year !== year || g.monthNumber < from || g.monthNumber > to) continue;
    completed += g.completed;
    dropped += g.dropped;
  }
  return { hours, platinum, completed, dropped };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Год: прошлый год целиком; для текущего года — январь..текущий месяц обоих лет (по месяцам, текущий месяц прошлого года целиком).
 * Месяц: тот же месяц прошлого года. Нет данных прошлого года (нет часов, завершений и платин) — null.
 */
export function buildYoy(cur: StatsResponse, prev: StatsResponse, sel: Selection, today: Today): Yoy | null {
  if (sel.period === 'all') return null;
  const py = sel.year - 1;
  let from = 1;
  let to = 12;
  let title = `К ${py} году`;
  let note: string | null = null;
  if (sel.period === 'month' && sel.month !== null) {
    from = to = sel.month;
    title = `К ${MONTHS_PREP[sel.month - 1]} ${py}`;
    if (sel.year === today.year && sel.month === today.month) note = `${MONTHS_SHORT[sel.month - 1]} ${py} — месяц целиком`;
  } else if (sel.year === today.year) {
    to = today.month;
    title = to === 1 ? `К январю ${py}` : `К янв–${MONTHS_SHORT[to - 1]} ${py}`;
    note = `${MONTHS_SHORT[to - 1]} ${py} — месяц целиком`;
  }
  const a = sumMonths(cur, sel.year, from, to);
  const b = sumMonths(prev, py, from, to);
  if (b.hours === null && b.completed === 0 && b.dropped === 0 && b.platinum === 0) return null;
  const items: YoyItem[] = [];
  if (a.hours !== null && b.hours !== null) items.push({ key: 'hours', label: 'часы', cur: r1(a.hours), prev: r1(b.hours), delta: r1(a.hours - b.hours) });
  items.push({ key: 'completed', label: 'пройдено', cur: a.completed, prev: b.completed, delta: a.completed - b.completed });
  if (a.dropped || b.dropped) items.push({ key: 'dropped', label: 'брошено', cur: a.dropped, prev: b.dropped, delta: a.dropped - b.dropped });
  items.push({ key: 'platinum', label: 'платины', cur: a.platinum, prev: b.platinum, delta: a.platinum - b.platinum });
  return { title, note, items };
}

/** «+12», «−3», «0» (минус — типографский). */
export function signed(n: number, fmt: (v: number) => string = String): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
}
