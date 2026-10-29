import { describe, expect, it } from 'vitest';
import type { Conflict, PlanItem, RoadmapResponse, WeekLoad } from '@/server/roadmap/types';
import {
  applyOrder, appendUnique, mergeVisibleOrder, upcomingBody, upcomingState, visibleQueue, budgetHint, buildQueueRows, conflictText, dropTarget, hoursLabel, layoutBars, moveBy, moveTo, orderGameIds, parseBudget, parseRowHours,
  periodText, progressView, rangeText, toPlannedBody, validateRelease, emptyValues, weekPos, catalogFail, platformsText, filterCandidates,
} from './model';

const e = (key: string, o: Record<string, unknown> = {}) => ({
  key, kind: key.startsWith('g:') ? 'backlog' : 'planned', gameId: key.startsWith('g:') ? Number(key.slice(2)) : null, plannedId: key.startsWith('p:') ? Number(key.slice(2)) : null,
  title: `T${key}`, coverUrl: null, hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false, ...o,
});
const weeks = [
  { index: 1, from: '2026-01-01', to: '2026-01-04', days: 4 }, { index: 2, from: '2026-01-05', to: '2026-01-11', days: 7 },
  { index: 3, from: '2026-01-12', to: '2026-01-18', days: 7 },
] as WeekLoad[];

describe('форматирование', () => {
  it('часы и даты', () => {
    expect(hoursLabel(7.5)).toBe('7,5 ч');
    expect(hoursLabel(14.4)).toBe('14 ч');
    expect(rangeText('2026-03-03', '2026-03-17')).toBe('3–17 мар.');
    expect(rangeText('2026-02-28', '2026-03-06')).toBe('28 февр. – 6 мар.');
    expect(rangeText('2026-03-03', '2026-03-03')).toBe('3 мар.');
  });
  it('ввод часов', () => {
    expect(parseBudget('7,5')).toBe(7.5);
    expect(parseBudget('0')).toBeNull();
    expect(parseBudget('101')).toBeNull();
    expect(parseRowHours('999')).toBe(999);
    expect(parseRowHours('0,3')).toBeNull();
    expect(parseRowHours('abc')).toBeNull();
  });
  it('подсказка бюджета', () => {
    expect(budgetHint(2026, 10, '2026-12-22')).toBe('Осталось 2 нед. · бюджет до конца года ≈ 14 ч');
    expect(budgetHint(2027, 10, '2026-10-29')).toMatch(/^52 нед\. · бюджет на год ≈ 521 ч$/);
  });
});

describe('склейка по key и порядок', () => {
  const d = {
    queue: [{ key: 'g:1', state: 'scheduled' }, { key: 'g:2', state: 'need_hours' }, { key: 'g:3', state: 'not_fit' }, { key: 'p:9', state: 'scheduled' }, { key: 'g:99', state: 'unplanned' }],
    items: [{ ...e('g:1'), start: '2026-01-01', end: '2026-01-10', days: 10, shiftedDays: 0, queuePosition: 1, segments: [] }, { ...e('p:9'), start: '2026-02-01', end: '2026-02-03', days: 3, shiftedDays: 0, queuePosition: 4, segments: [] }],
    notFit: [{ ...e('g:3'), reason: 'no_capacity', hoursShort: 5 }],
    needHours: [e('g:2', { hours: null })],
  } as unknown as Pick<RoadmapResponse, 'queue' | 'items' | 'notFit' | 'needHours'>;
  it('соединяет и пропускает записи без данных', () => {
    const rows = buildQueueRows(d);
    expect(rows.map((r) => r.key)).toEqual(['g:1', 'g:2', 'g:3', 'p:9']);
    expect(rows[0].item?.start).toBe('2026-01-01');
    expect(rows[2].notFit?.hoursShort).toBe(5);
    expect(rows.map((r) => r.movable)).toEqual([true, true, true, false]);
  });
  it('локальный порядок только для g:*', () => {
    const rows = buildQueueRows(d);
    expect(applyOrder(rows, ['g:3', 'g:1']).map((r) => r.key)).toEqual(['g:3', 'g:1', 'g:2', 'p:9']);
    expect(applyOrder(rows, null).map((r) => r.key)).toEqual(['g:1', 'g:2', 'g:3', 'p:9']);
  });
  it('gameIds', () => expect(orderGameIds(['g:3', 'p:1', 'g:1'])).toEqual([3, 1]));
  it('перестановка', () => {
    expect(moveBy(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveBy(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
  it('цель дропа', () => {
    expect(dropTarget(2, 0, 'before')).toBe(0);
    expect(dropTarget(0, 2, 'after')).toBe(2);
    expect(dropTarget(1, 1, 'before')).toBeNull();
    expect(dropTarget(1, 2, 'before')).toBeNull();
    expect(dropTarget(1, 0, 'after')).toBeNull();
  });
});

describe('таймлайн', () => {
  it('неделя по дате', () => {
    expect(weekPos(weeks, '2026-01-01')).toBe(0);
    expect(weekPos(weeks, '2026-01-11')).toBe(1);
    expect(weekPos(weeks, '2025-12-01')).toBe(0);
    expect(weekPos(weeks, '2027-01-01')).toBe(2);
  });
  it('жадная укладка по строкам, дорожки раздельно, несколько сегментов', () => {
    const it = (key: string, kind: string, segs: [string, string][]) => ({
      ...e(key, { kind }), start: segs[0][0], end: segs[segs.length - 1][1], days: 1, shiftedDays: 0, queuePosition: 1,
      segments: segs.map(([from, to]) => ({ from, to, days: 1, hours: 1 })),
    }) as unknown as PlanItem;
    const { bars, rows } = layoutBars([
      it('g:1', 'backlog', [['2026-01-01', '2026-01-11']]), it('g:2', 'backlog', [['2026-01-05', '2026-01-05'], ['2026-01-12', '2026-01-18']]),
      it('p:1', 'release', [['2026-01-05', '2026-01-11']]),
    ], weeks);
    expect(rows).toEqual({ release: 1, queue: 2 });
    expect(bars.filter((b) => b.lane === 'queue').map((b) => [b.key, b.row])).toEqual([['g:1', 0], ['g:2', 1], ['g:2', 0]]);
    expect(periodText(it('g:2', 'backlog', [['2026-01-05', '2026-01-05'], ['2026-01-12', '2026-01-18']]))).toBe('5 янв. и 12–18 янв.');
  });
});

describe('конфликт и прогресс', () => {
  const base = {
    items: [{ ...e('p:1', { kind: 'release', title: 'А', releaseDate: '2026-11-02' }), start: '2026-11-02', end: '2026-11-29', days: 28, shiftedDays: 0, segments: [{ from: '2026-11-02', to: '2026-11-29', days: 28, hours: 40 }] },
      { ...e('p:2', { kind: 'release', title: 'Б', releaseDate: '2026-11-10' }), start: '2026-11-30', end: '2026-12-13', days: 14, shiftedDays: 20, segments: [] }],
    notFit: [], needHours: [], settings: { year: 2026, hoursPerWeek: 10, configured: true }, range: { from: '2026-01-01', to: '2026-12-31', days: 365 },
  } as unknown as Pick<RoadmapResponse, 'items' | 'notFit' | 'needHours' | 'settings' | 'range'>;
  it('overlap: текст по reason из API', () => {
    const t = conflictText({ reason: 'release_overlap', from: '2026-11-10', to: '2026-11-29', keys: ['p:1', 'p:2'] }, 1, base);
    expect(t.title).toBe('Конфликт 1: пересечение релизов, 10–29 нояб.');
    expect(t.body).toContain('«А» (выходит 2 нояб., 4 нед.) и «Б» (выходит 10 нояб., 2 нед.)');
    expect(t.body).toContain('сдвинут на 20 дн.');
  });
  it('starts_before_year: игра может не быть в items, названия из planned или «игра из плана»', () => {
    const c: Conflict = { reason: 'starts_before_year', from: '2025-12-20', to: '2025-12-31', keys: ['p:5'] };
    const extra = new Map([['p:5', { title: 'Старый', releaseDate: '2025-12-20' }]]);
    const t = conflictText(c, 2, base, extra);
    expect(t.title).toBe('Конфликт 2: релиз вышел до начала года, 20–31 дек. 2025');
    expect(t.body).toContain('«Старый» вышла 20 дек. 2025');
    expect(t.body).toContain('Окно целиком в прошлом году');
    const t2 = conflictText(c, 1, base);
    expect(t2.body).toContain('«игра из плана»');
  });
  it('прогресс по состояниям', () => {
    const p = { status: 'behind', from: '2026-01-01', asOf: '2026-10-28', plannedHours: 280, actualHours: 262, diffHours: -18, toleranceHours: 2, budgetHours: 1 };
    const d = { progress: p, items: [1], settings: { year: 2026 }, totals: { capacityHours: 500 }, today: '2026-10-29' } as unknown as RoadmapResponse;
    expect(progressView(d)).toMatchObject({ kind: 'behind', scale: 500 });
    expect(progressView({ ...d, progress: { ...p, status: 'onTrack' } } as RoadmapResponse).kind).toBe('on_track');
    expect(progressView({ ...d, items: [] } as unknown as RoadmapResponse).kind).toBe('empty');
    expect(progressView({ ...d, settings: { year: 2025 } } as unknown as RoadmapResponse).kind).toBe('past');
    expect(progressView({ ...d, settings: { year: 2027 } } as unknown as RoadmapResponse).kind).toBe('not_started');
    expect(progressView({ ...d, progress: { ...p, status: 'no_data' } } as RoadmapResponse).kind).toBe('no_data');
  });
});

describe('форма релиза и каталог', () => {
  it('валидация', () => {
    expect(validateRelease(emptyValues()).title).toBe('Введи название');
    expect(validateRelease({ ...emptyValues(), title: 'x', want: true }).want).toBe('Для галки нужна дата релиза');
    expect(validateRelease({ ...emptyValues(), title: 'x', coverUrl: 'http://a' }).cover).toBeTruthy();
    expect(validateRelease({ ...emptyValues(), title: 'x', hours: '1000' }).hours).toBeTruthy();
    expect(validateRelease({ ...emptyValues(), title: 'x', date: '2026-02-30' }).date).toBeTruthy();
  });
  it('тело запроса', () => {
    const v = { ...emptyValues(), title: ' Игра ', date: '2026-12-05', hours: '14,5', want: true, externalId: '7' };
    expect(toPlannedBody(v, true)).toEqual({ title: 'Игра', releaseDate: '2026-12-05', coverUrl: null, wantAtRelease: true, hoursManual: 14.5, externalSource: 'rawg', externalId: '7' });
    expect(toPlannedBody({ ...v, noDate: true }, false)).toMatchObject({ releaseDate: null, wantAtRelease: false });
  });
  it('каталог', () => {
    expect(catalogFail('no_key').kind).toBe('not_configured');
    expect(catalogFail('rate_limited').kind).toBe('rate_limited');
    expect(catalogFail('timeout').kind).toBe('unavailable');
    expect(platformsText(['PC', 'PlayStation 5', 'PlayStation 4'])).toBe('PS5, PS4');
    expect(filterCandidates([{ playstation: true }, { playstation: false }], true)).toHaveLength(1);
  });
});

describe('полный порядок со скрытыми not_fit', () => {
  it('скрытые игры сохраняют места, видимые переставляются', () => {
    expect(mergeVisibleOrder(['g:1', 'g:2', 'g:3'], ['g:3', 'g:1'])).toEqual(['g:3', 'g:2', 'g:1']);
    expect(mergeVisibleOrder(['g:1', 'g:2', 'g:3', 'g:4'], ['g:1', 'g:4', 'g:3'])).toEqual(['g:1', 'g:2', 'g:4', 'g:3'].map((k, i) => (i === 1 ? 'g:2' : k)));
    expect(mergeVisibleOrder(['g:9', 'g:1', 'g:2'], ['g:2', 'g:1'])).toEqual(['g:9', 'g:2', 'g:1']);
  });
  it('без скрытых совпадает с видимым порядком, чужие ключи игнорируются', () => {
    expect(mergeVisibleOrder(['g:1', 'g:2'], ['g:2', 'g:1'])).toEqual(['g:2', 'g:1']);
    expect(mergeVisibleOrder(['g:1', 'g:2'], ['g:2', 'g:1', 'g:77'])).toEqual(['g:2', 'g:1']);
    expect(mergeVisibleOrder(['g:1', 'g:2', 'g:3'], ['g:1'])).toEqual(['g:1', 'g:2', 'g:3'].slice(0, 3));
  });
  it('visibleQueue убирает not_fit', () => {
    const rows = [{ key: 'g:1', state: 'scheduled' }, { key: 'g:2', state: 'not_fit' }, { key: 'g:3', state: 'need_hours' }] as unknown as Parameters<typeof visibleQueue>[0];
    expect(visibleQueue(rows).map((r) => r.key)).toEqual(['g:1', 'g:3']);
  });
});

describe('предстоящие релизы', () => {
  const c = (id: string, o: Record<string, unknown> = {}) => ({
    externalSource: 'rawg', externalId: id, title: `T${id}`, releaseDate: '2026-12-01', coverUrl: null, platforms: [], playstation: true, planned: false, unallocated: false, plannedId: null, ...o,
  }) as unknown as Parameters<typeof appendUnique>[0][number];
  it('состояние: актуальные списки важнее пометок каталога', () => {
    expect(upcomingState(c('1'), null, null)).toBe('new');
    expect(upcomingState(c('1', { planned: true, plannedId: 5 }), new Set([5]), new Set())).toBe('planned');
    expect(upcomingState(c('1', { planned: true, plannedId: 5 }), new Set(), new Set([5]))).toBe('unallocated');
    expect(upcomingState(c('1', { planned: true, unallocated: true, plannedId: 5 }), null, null)).toBe('unallocated');
  });
  it('тело POST: галка на релизе по умолчанию, часы пустые', () => {
    expect(upcomingBody(c('9'))).toEqual({ title: 'T9', releaseDate: '2026-12-01', coverUrl: null, wantAtRelease: true, hoursManual: null, externalSource: 'rawg', externalId: '9' });
  });
  it('страницы дописываются без повторов', () => {
    expect(appendUnique([c('1'), c('2')], [c('2'), c('3')]).map((x) => x.externalId)).toEqual(['1', '2', '3']);
  });
});
