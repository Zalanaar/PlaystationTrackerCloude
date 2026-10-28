import { describe, expect, it } from 'vitest';
import {
  barsHaveEstimate, estimateNote, monthHoursText, playedGamesCount, formatHours, formatIsoDay, genreBars, highlightedMonth, hoursBars, linePath, linePoints, parseSelection,
  periodLabel, selectionToParams, setPeriodType, shiftSelection, todayMsk,
  genreGames, genreSubtitle, pointsLabel, pointsText, topHoursRows, topTrophyRows, TOP_SUBTITLE,
} from './model';
import type { GameItem } from '@/server/collection/types';
import type { TopHoursItem, TopTrophyItem } from '@/server/stats/types';

const today = { year: 2026, month: 10 };
const sp = (q: string) => new URLSearchParams(q);

describe('параметры URL', () => {
  it('по умолчанию текущий год', () => {
    expect(parseSelection(sp(''), today)).toEqual({ period: 'year', year: 2026, month: null });
  });
  it('мусор заменяется значениями по умолчанию, будущее обрезается', () => {
    expect(parseSelection(sp('period=x&year=abc'), today)).toEqual({ period: 'year', year: 2026, month: null });
    expect(parseSelection(sp('year=2031'), today).year).toBe(2026);
    expect(parseSelection(sp('period=month&year=2026&month=12'), today).month).toBe(10);
    expect(parseSelection(sp('period=month&year=2025&month=0'), today).month).toBe(12);
  });
  it('месяц читается и пишется обратно', () => {
    const s = parseSelection(sp('period=month&year=2026&month=3'), today);
    expect(s).toEqual({ period: 'month', year: 2026, month: 3 });
    expect(selectionToParams(s).toString()).toBe('period=month&year=2026&month=3');
  });
  it('переключение года на месяц', () => {
    expect(setPeriodType({ period: 'year', year: 2026, month: null }, 'month', today).month).toBe(10);
    expect(setPeriodType({ period: 'year', year: 2025, month: null }, 'month', today).month).toBe(12);
    expect(setPeriodType({ period: 'month', year: 2025, month: 4 }, 'year', today)).toEqual({ period: 'year', year: 2025, month: null });
  });
});

describe('стрелки', () => {
  const years = [2026, 2025, 2024];
  it('год: не уходит за доступные и в будущее', () => {
    const y = (n: number) => ({ period: 'year' as const, year: n, month: null });
    expect(shiftSelection(y(2026), 1, years, today)).toBeNull();
    expect(shiftSelection(y(2026), -1, years, today)?.year).toBe(2025);
    expect(shiftSelection(y(2024), -1, years, today)).toBeNull();
  });
  it('месяц: переходит через границу года, не уходит в будущее', () => {
    const m = (y: number, mo: number) => ({ period: 'month' as const, year: y, month: mo });
    expect(shiftSelection(m(2026, 1), -1, years, today)).toEqual(m(2025, 12));
    expect(shiftSelection(m(2025, 12), 1, years, today)).toEqual(m(2026, 1));
    expect(shiftSelection(m(2026, 10), 1, years, today)).toBeNull();
    expect(shiftSelection(m(2024, 1), -1, years, today)).toBeNull();
  });
  it('пустой список лет: только текущий', () => {
    expect(shiftSelection({ period: 'year', year: 2026, month: null }, -1, [], today)).toBeNull();
  });
});

describe('форматирование', () => {
  it('часы', () => {
    expect(formatHours(31.54)).toBe('31,5');
    expect(formatHours(40)).toBe('40');
    expect(formatHours(0)).toBe('0');
    expect(formatHours(1234.5)).toBe('1 234,5');
  });
  it('дата первого синка', () => {
    expect(formatIsoDay('2026-03-04')).toBe('04.03.2026');
    expect(formatIsoDay(null)).toBeNull();
    expect(estimateNote('2026-03-04')).toBe(
      'До 04.03.2026 часы оценены: распределены равномерно между первым и последним запуском игры. С этой даты часы измеряются по ежедневным снимкам.',
    );
    expect(estimateNote(null)).toBe(
      'Часы оценены: распределены равномерно между первым и последним запуском игры. Точные данные появятся после ежедневных синков.',
    );
  });
  it('подпись периода и сегодня по Москве', () => {
    expect(periodLabel({ period: 'month', year: 2026, month: 10 })).toBe('Октябрь 2026');
    expect(periodLabel({ period: 'year', year: 2026, month: null })).toBe('2026');
    expect(todayMsk(Date.parse('2026-12-31T22:00:00Z'))).toEqual({ year: 2027, month: 1 });
  });
});

describe('графики', () => {
  it('столбцы часов: null без высоты, максимум 100%, ноль без столбца', () => {
    const bars = hoursBars([null, 0, 10, 20, null, null, null, null, null, null, null, null]);
    expect(bars).toHaveLength(12);
    expect(bars[0]).toMatchObject({ value: null, heightPct: 0, text: 'Январь: нет данных по часам' });
    expect(bars[1]).toMatchObject({ value: 0, heightPct: 0, text: 'Февраль: 0 ч' });
    expect(bars[2].heightPct).toBe(50);
    expect(bars[3]).toMatchObject({ heightPct: 100, text: 'Апрель: 20 ч' });
  });
  it('стек: измеренная часть снизу, оценочная сверху, aria-label с обеими частями', () => {
    const bars = hoursBars([null, 12, 10, 20, ...Array(8).fill(null)], [0, 7, 0, 0, ...Array(8).fill(0)], 2026);
    expect(bars[1]).toMatchObject({ value: 12, real: 5, estimated: 7, title: 'Февраль 2026', text: 'Февраль 2026: 12 ч, из них 7 ч оценка' });
    expect(bars[1].realShare).toBeCloseTo((5 / 12) * 100);
    expect(bars[1].heightPct).toBe(60);
    expect(bars[2]).toMatchObject({ real: 10, estimated: 0, realShare: 100, text: 'Март 2026: 10 ч' });
    expect(bars[0]).toMatchObject({ value: null, heightPct: 0, text: 'Январь 2026: нет данных по часам' });
    expect(barsHaveEstimate(bars)).toBe(true);
    expect(barsHaveEstimate(hoursBars([1, 2], [0, 0]))).toBe(false);
  });
  it('месяц целиком оценочный; оценка не больше всего; пустой месяц без столбца', () => {
    const [a, b, c] = hoursBars([10, 4, 0, ...Array(9).fill(null)], [10, 9, 0, ...Array(9).fill(0)]);
    expect(a).toMatchObject({ real: 0, estimated: 10, realShare: 0 });
    expect(b).toMatchObject({ real: 0, estimated: 4 });
    expect(c).toMatchObject({ heightPct: 0, estimated: 0 });
  });
  it('все null и крошечные значения', () => {
    expect(hoursBars(Array(12).fill(null)).every((b) => b.heightPct === 0)).toBe(true);
    expect(hoursBars([0.1, 100, ...Array(10).fill(null)])[0].heightPct).toBe(3);
  });
  it('подсветка месяца', () => {
    expect(highlightedMonth({ period: 'year', year: 2026, month: null }, today)).toBe(10);
    expect(highlightedMonth({ period: 'year', year: 2025, month: null }, today)).toBeNull();
    expect(highlightedMonth({ period: 'month', year: 2025, month: 3 }, today)).toBe(3);
  });
  it('жанры: ширина от максимума, значение с одним знаком', () => {
    const g = genreBars([{ key: 'A', label: 'Экшен', value: 14.5 }, { key: 'B', label: 'Гонки', value: 7.25 }]);
    expect(g[0]).toMatchObject({ widthPct: 100, text: '14,5' });
    expect(g[1].widthPct).toBeCloseTo(50);
    expect(genreBars([])).toEqual([]);
  });
  it('линия трофеев: колонки по центру, нули на дне', () => {
    const pts = linePoints([0, 5, 10, 0], 400, 100, 10);
    expect(pts.map((p) => p.x)).toEqual([50, 150, 250, 350]);
    expect(pts[2].y).toBe(10);
    expect(pts[0].y).toBe(90);
    expect(linePoints([0, 0], 100, 50, 5).every((p) => p.y === 45)).toBe(true);
    expect(linePath(pts)).toBe('M50.0 90.0 L150.0 50.0 L250.0 10.0 L350.0 90.0');
  });
});

describe('«Игры месяца»', () => {
  it('часы за месяц: формат, оценка, ноль', () => {
    expect(monthHoursText(12.5, false)).toEqual({ text: '12 ч 30 м', label: '12 ч 30 м за месяц' });
    expect(monthHoursText(3, true)).toEqual({ text: '≈ 3 ч', label: 'примерно 3 ч за месяц' });
    expect(monthHoursText(0.5, false)?.text).toBe('30 м');
    expect(monthHoursText(0, false)).toBeNull();
    expect(monthHoursText(Number.NaN, true)).toBeNull();
  });
  it('игра в двух месяцах считается один раз', () => {
    const item = (id: number) => ({ game: { id } }) as never;
    const groups = [
      { month: '2026-03', year: 2026, monthNumber: 3, completed: 0, dropped: 0, items: [item(1), item(2)] },
      { month: '2026-02', year: 2026, monthNumber: 2, completed: 0, dropped: 0, items: [item(1)] },
    ];
    expect(playedGamesCount(groups)).toBe(2);
    expect(playedGamesCount([])).toBe(0);
  });
});

const topGame = (id: number): GameItem => ({
  id, title: `G${id}`, coverUrl: null, bannerUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: null, status: null,
  completedAt: null, droppedAt: null, trophies: null, genres: [], hiddenAt: null,
});

describe('жанры: поповер', () => {
  it('genreBars несёт gameIds и значение', () => {
    const g = genreBars([{ key: 'A', label: 'Экшен', value: 14.5, gameIds: [3, 1] }, { key: 'B', label: 'Гонки', value: 2 }]);
    expect(g[0]).toMatchObject({ gameIds: [3, 1], value: 14.5 });
    expect(g[1].gameIds).toEqual([]);
  });
  it('миниатюры: порядок gameIds, лимит, остаток «+N», id без записи пропускаются', () => {
    const games = Object.fromEntries([1, 2, 3, 4, 5].map((id) => [String(id), { id, title: `G${id}`, coverUrl: null }]));
    const r = genreGames([5, 4, 99, 3, 2, 1], games, 3);
    expect(r.shown.map((g) => g.id)).toEqual([5, 4, 3]);
    expect(r).toMatchObject({ rest: 2, total: 5 });
    expect(genreGames([1], games, 12)).toMatchObject({ rest: 0, total: 1 });
    expect(genreGames([], games, 12)).toEqual({ shown: [], rest: 0, total: 0 });
  });
  it('подзаголовок: часы и игры, без часов только игры', () => {
    expect(genreSubtitle(12.4, 8)).toBe('12,4 ч · 8 игр');
    expect(genreSubtitle(3, 1)).toBe('3 ч · 1 игра');
    expect(genreSubtitle(0, 2)).toBe('2 игры');
  });
});

describe('топ игр', () => {
  const hours: TopHoursItem[] = [{ game: topGame(1), hours: 85.4, estimated: false }, { game: topGame(2), hours: 42.7, estimated: true }];
  it('часы: ранги, бар от лидера, оценка с «≈»', () => {
    const r = topHoursRows(hours);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
    expect(r[0]).toMatchObject({ widthPct: 100, valueText: '85 ч 24 м', approx: false, valueLabel: '85 ч 24 м' });
    expect(r[1].widthPct).toBeCloseTo(50);
    expect(r[1]).toMatchObject({ approx: true, valueLabel: 'Примерно 42 ч 42 м. Часть часов оценена' });
    expect(topHoursRows([])).toEqual([]);
  });
  it('часы: крошечное значение не даёт нулевой бар', () => {
    const r = topHoursRows([{ game: topGame(1), hours: 100, estimated: false }, { game: topGame(2), hours: 0.01, estimated: false }]);
    expect(r[1].widthPct).toBe(2);
    expect(r[1].valueText).toBe('меньше минуты');
  });
  const tr: TopTrophyItem[] = [
    { game: topGame(1), points: 840, counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 } },
    { game: topGame(2), points: 15, counts: { platinum: 0, gold: 0, silver: 0, bronze: 1, total: 1 } },
  ];
  it('трофеи: очки, подсказка, нулевые типы не выводятся', () => {
    const r = topTrophyRows(tr);
    expect(r[0].valueText).toBe('840 очк.');
    expect(r[0].valueLabel).toBe('840 очков: платина 1, золото 5, серебро 12, бронза 20');
    expect(r[0].counts.map((c) => c.kind)).toEqual(['platinum', 'gold', 'silver', 'bronze']);
    expect(r[1].counts).toEqual([{ kind: 'bronze', count: 1 }]);
    expect(r[1].valueLabel).toBe('15 очков: бронза 1');
  });
  it('склонение очков и подпись режима', () => {
    expect(pointsText(1)).toBe('1 очко');
    expect(pointsText(30)).toBe('30 очков');
    expect(pointsLabel(0, { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 })).toBe('0 очков');
    expect(TOP_SUBTITLE.trophies).toBe('Очки за трофеи периода: платина 300, золото 90, серебро 30, бронза 15');
  });
});
