// F3 «Лента трофеев»: чистая часть (разбор запроса, курсор, границы периода). Выборка в feed-query.ts.
import type { FeedPeriod } from './types';

export const FEED_LIMIT = 50;
export const FEED_MAX_LIMIT = 100;
/** «Только редкие»: PSN ultra rare, earned_rate < 5 % (решение Artem, вопрос 14). */
export const RARE_THRESHOLD = 5;
const DAY_MS = 86_400_000;
const PERIODS: readonly FeedPeriod[] = ['7d', 'month', 'all'];

/** Нижняя граница (строгая, как окно «Входящих»): 7d = 7×24 ч, month = 30×24 ч, all = нет. */
export function periodSince(p: FeedPeriod, now: Date): Date | null {
  if (p === 'all') return null;
  return new Date(now.getTime() - (p === '7d' ? 7 : 30) * DAY_MS);
}

/** Курсор keyset: `<earnedAt ms | n>_<trophies.id>`; порядок earned_at desc nulls last, id desc. */
export type FeedCursor = { at: number | null; id: number };

export function encodeCursor(c: FeedCursor): string {
  return `${c.at === null ? 'n' : String(c.at)}_${c.id}`;
}

export function decodeCursor(s: string): FeedCursor | null {
  const m = /^(n|\d{1,15})_(\d{1,10})$/.exec(s);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { at: m[1] === 'n' ? null : Number(m[1]), id };
}

export type FeedQuery = { period: FeedPeriod; rare: boolean; cursor: FeedCursor | null; limit: number };

export function parseFeedQuery(sp: URLSearchParams): { ok: true; value: FeedQuery } | { ok: false; message: string } {
  const p = sp.get('period') ?? '7d';
  if (!PERIODS.includes(p as FeedPeriod)) return { ok: false, message: 'period: 7d | month | all.' };
  const r = sp.get('rare');
  if (r !== null && r !== '0' && r !== '1') return { ok: false, message: 'rare: 0 | 1.' };
  const c = sp.get('cursor');
  const cursor = c === null || c === '' ? null : decodeCursor(c);
  if (c && !cursor) return { ok: false, message: 'cursor: неверный формат.' };
  const l = sp.get('limit');
  const limit = l === null ? FEED_LIMIT : Number(l);
  if (!Number.isInteger(limit) || limit < 1 || limit > FEED_MAX_LIMIT) return { ok: false, message: `limit: 1..${FEED_MAX_LIMIT}.` };
  return { ok: true, value: { period: p as FeedPeriod, rare: r === '1', cursor, limit } };
}

/** numeric(5,2) приходит строкой. */
export function toRate(r: string | number | null): number | null {
  if (r === null) return null;
  const n = Number(r);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
