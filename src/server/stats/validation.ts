// Разбор query GET /api/stats (контракт 10.1). Чистая функция.
import type { StatsPeriodType } from './types';
import { MSK_TZ, parseTzParam } from '@/shared/tz';

export type StatsQuery = { type: StatsPeriodType; year: number; month: number | null; /** 17.2: вернуть в «Редкие трофеи» игры-сервисы (по умолчанию нет) */ withService?: boolean; /** Пакет 6, п. 3: пояс устройства для «Когда ты играешь» (часы и дни недели); нет = МСК */ tz?: string };
export type StatsParsed = { ok: true; value: StatsQuery } | { ok: false; message: string };

const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

function int(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** `withService` (контракт 20.8): 1|true включить, 0|false|нет = выключено; иное = null (ошибка). */
export function parseWithService(raw: string | null): boolean | null {
  if (raw === null || raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  return null;
}

/** currentYear: год МСК «сегодня» (по умолчанию для year). */
export function parseStatsQuery(sp: URLSearchParams, currentYear: number): StatsParsed {
  const pRaw = sp.get('period') ?? 'year';
  if (pRaw !== 'year' && pRaw !== 'month' && pRaw !== 'all') return bad('Некорректный период.');
  let year = currentYear;
  const yRaw = sp.get('year');
  // 26.1: при period=all year и month игнорируются (в том числе мусорные)
  if (pRaw !== 'all' && yRaw !== null && yRaw !== '') {
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
  const ws = parseWithService(sp.get('withService'));
  if (ws === null) return bad('Некорректный параметр withService.');
  const tz = parseTzParam(sp.get('tz'));
  return { ok: true, value: { type: pRaw, year, month, ...(ws ? { withService: true } : {}), ...(tz !== MSK_TZ ? { tz } : {}) } };
}

/** GET /api/stats/activity (14.3): только year, по умолчанию текущий год МСК; пустая строка = нет параметра. */
export function parseActivityQuery(sp: URLSearchParams, currentYear: number): { ok: true; value: { year: number } } | { ok: false; message: string } {
  const yRaw = sp.get('year');
  if (yRaw === null || yRaw === '') return { ok: true, value: { year: currentYear } };
  const y = int(yRaw, 2000, 2100);
  return y === null ? bad('Некорректный год.') : { ok: true, value: { year: y } };
}
