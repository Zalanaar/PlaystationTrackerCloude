// Фаза 34: вид «Истории игры» (чистые функции).
import { describe, expect, it } from 'vitest';
import type { GameHistory } from '@/server/collection/types';
import { historyLine, historyView } from './history';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const week = (weekStart: string, seconds = 0, estimatedSeconds = 0, trophies = 0, platinum = false) => ({ weekStart, seconds, estimatedSeconds, trophies, platinum });
const hist = (o: Partial<GameHistory> = {}): GameHistory => ({
  weeks: [week('2026-05-04', 7200, 3600), week('2026-05-11', 3600), week('2026-05-18', 0, 0, 2, true)],
  truncated: false, hasHours: true, hasEstimate: true, playedDays: 14, firstSnapshotDate: '2026-05-12', ...o,
});

describe('historyLine', () => {
  it('«Играл 14 дней, последний раз 6 июн.»', () => {
    expect(historyLine(hist(), '2026-06-06T10:00:00Z', NOW)).toEqual({ played: '14 дней', last: '6 июн.' });
  });
  it('склонение дней', () => {
    expect(historyLine(hist({ playedDays: 1 }), null, NOW)?.played).toBe('1 день');
    expect(historyLine(hist({ playedDays: 3 }), null, NOW)?.played).toBe('3 дня');
    expect(historyLine(hist({ playedDays: 21 }), null, NOW)?.played).toBe('21 день');
  });
  it('нет снимков: только «последний раз»; 0 дней не пишем; ничего нет: null', () => {
    expect(historyLine(hist({ playedDays: null }), '2026-06-06T10:00:00Z', NOW)).toEqual({ played: null, last: '6 июн.' });
    expect(historyLine(hist({ playedDays: 0 }), '2026-06-06T10:00:00Z', NOW)?.played).toBeNull();
    expect(historyLine(hist({ playedDays: null }), null, NOW)).toBeNull();
  });
  it('прошлый год: дата с годом', () => {
    expect(historyLine(hist(), '2025-06-06T10:00:00Z', NOW)?.last).toBe('06.06.2025');
  });
});

describe('historyView', () => {
  it('null без истории и без недель', () => {
    expect(historyView(null)).toBeNull();
    expect(historyView(undefined)).toBeNull();
    expect(historyView(hist({ weeks: [] }))).toBeNull();
  });

  it('высоты относительно максимума, оценка отдельно, отметки, граница синка', () => {
    const v = historyView(hist())!;
    expect(v.showHours).toBe(true);
    expect(v.bars.map((b) => Math.round(b.totalPct))).toEqual([100, 50, 0]);
    expect(v.bars[0]).toMatchObject({ realSec: 3600, estSec: 3600 });
    expect(v.bars.map((b) => b.mark)).toEqual([null, null, 'platinum']);
    expect(v.bars.map((b) => b.syncStart)).toEqual([false, true, false]);
    expect(v.hasEstimate).toBe(true);
    expect(v.hasPlatinum).toBe(true);
    expect(v.hasTrophies).toBe(true);
    expect(v.syncLabel).toBe('12 мая');
    expect(v.axisStart).toBe('4 мая');
    expect(v.axisEnd).toBe('18 мая');
    expect(v.bars[0].title).toBe('Неделя с 4 мая: 2 ч (из них оценка 1 ч)');
    expect(v.bars[2].title).toBe('Неделя с 18 мая: без часов, трофеев 2, платина');
    expect(v.summary).toContain('больше всего 2 ч на неделе с 4 мая');
    expect(v.summary).toContain('платина получена на неделе с 18 мая');
  });

  it('без часов: столбцов нет, остаются отметки', () => {
    const v = historyView(hist({ weeks: [week('2026-05-18', 0, 0, 1, false)], hasHours: false, hasEstimate: false, playedDays: null, firstSnapshotDate: null }))!;
    expect(v.showHours).toBe(false);
    expect(v.bars[0]).toMatchObject({ totalPct: 0, mark: 'trophy' });
    expect(v.syncLabel).toBeNull();
    expect(v.summary).toContain('часов нет, только трофеи');
  });

  it('первый синк вне показанного ряда: линии нет; усечение помечается в оси', () => {
    const v = historyView(hist({ firstSnapshotDate: '2025-01-01', truncated: true }))!;
    expect(v.bars.some((b) => b.syncStart)).toBe(false);
    expect(v.syncLabel).toBeNull();
    expect(v.axisStart).toBe('… 4 мая');
  });

  it('ряд через границу года: на оси годы', () => {
    const v = historyView(hist({ weeks: [week('2025-12-29', 600), week('2026-01-05', 600)] }))!;
    expect(v.axisStart).toBe('29 дек. 2025');
    expect(v.axisEnd).toBe('5 янв. 2026');
  });
});
