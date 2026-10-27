// Разбор query GET /api/stats (контракт 10.1). Чистая функция.
import type { StatsPeriodType } from './types';

export type StatsQuery = { type: StatsPeriodType; year: number; month: number | null };
export type StatsParsed = { ok: true; value: StatsQuery } | { ok: false; message: string };

const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

function int(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** currentYear: год МСК «сегодня» (по умолчанию для year). */
export function parseStatsQuery(sp: URLSearchParams, currentYear: number): StatsParsed {
  const pRaw = sp.get('period') ?? 'year';
  if (pRaw !== 'year' && pRaw !== 'month') return bad('Некорректный период.');
  let year = currentYear;
  const yRaw = sp.get('year');
  if (yRaw !== null && yRaw !== '') {
    const y = int(yRaw, 2000, 2100);
    if (y === null) return bad('Некорректный год.');
    year = y;
  }
  let month: number | null = null;
  if (pRaw === 'month') {
    const mRaw = sp.get('month');
    const m = mRaw === null || mRaw === '' ? null : int(mRaw, 1, 12);
    if (m === null) return bad('Для периода «месяц» нужен month от 1 до 12.');
    month = m;
  }
  return { ok: true, value: { type: pRaw, year, month } };
}
