import { describe, expect, it, it as it_ } from 'vitest';
import type { Conflict, PlanItem, RoadmapResponse } from '@/server/roadmap/types';
import {
  applyOrder, appendUnique, dayIndex, daySpan, spanPct, monthSpans, backlogKeys, backlogPositions, buildSchedule, dropOrder, mergeVisibleOrder, upcomingBody, upcomingState, visibleQueue, insertHint, orderWithAtPosition, removedToast, placedToast, budgetHint, buildQueueRows, conflictText, dropTarget, hoursLabel, layoutBars, moveBy, moveTo, orderGameIds, parseBudget, parseRowHours,
  periodText, progressView, rangeText, toPlannedBody, validateRelease, emptyValues, catalogFail, platformsText, filterCandidates, paceView,
} from './model';

const e = (key: string, o: Record<string, unknown> = {}) => ({
  key, kind: key.startsWith('g:') ? 'backlog' : 'planned', gameId: key.startsWith('g:') ? Number(key.slice(2)) : null, plannedId: key.startsWith('p:') ? Number(key.slice(2)) : null,
  title: `T${key}`, coverUrl: null, hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false, ...o,
});


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

describe('таймлайн по дням', () => {
  const r26 = { from: '2026-01-01', to: '2026-12-31', days: 365 };
  const r28 = { from: '2028-01-01', to: '2028-12-31', days: 366 };
  it('индекс дня и обрезка по границам года', () => {
    expect(dayIndex('2026-01-01', '2026-01-01')).toBe(0);
    expect(dayIndex('2026-01-01', '2026-12-31')).toBe(364);
    expect(dayIndex('2028-01-01', '2028-12-31')).toBe(365); // високосный год
    expect(dayIndex('2028-01-01', '2028-03-01') - dayIndex('2028-01-01', '2028-02-28')).toBe(2); // 29 февраля есть
    expect(daySpan(r26, '2026-03-01', '2026-03-01')).toEqual({ startDay: 59, endDay: 59 }); // полоса в один день
    expect(daySpan(r26, '2025-12-20', '2026-01-09')).toEqual({ startDay: 0, endDay: 8 }); // стык лет: начало обрезано
    expect(daySpan(r26, '2026-12-20', '2027-01-09')).toEqual({ startDay: 353, endDay: 364 }); // конец обрезан
    expect(daySpan(r26, '2025-11-01', '2025-12-31')).toBeNull();
    expect(daySpan(r26, '2027-01-01', '2027-02-01')).toBeNull();
  });
  it('проценты ширины: один день и весь год', () => {
    expect(spanPct(0, 364, 365)).toEqual({ left: 0, width: 100 });
    const one = spanPct(59, 59, 365);
    expect(one.width).toBeCloseTo(100 / 365, 6);
    expect(one.left).toBeCloseTo((59 / 365) * 100, 6);
  });
  it('границы месяцев (февраль в високосный год 29 дней)', () => {
    const feb = monthSpans([{ from: '2028-01-01', days: 31 }, { from: '2028-02-01', days: 29 }, { from: '2028-03-01', days: 31 }], r28);
    expect(feb.map((m) => m.startDay)).toEqual([0, 31, 60]);
    expect(feb[1].startDay + feb[1].days).toBe(feb[2].startDay);
  });
  it('очередь одной дорожкой: соседние игры встык делят неделю, но не уходят на другую строку; чередование тона', () => {
    const it = (key: string, kind: string, segs: [string, string][]) => ({
      ...e(key, { kind }), start: segs[0][0], end: segs[segs.length - 1][1], days: 1, shiftedDays: 0, queuePosition: 1,
      segments: segs.map(([from, to]) => ({ from, to, days: 1, hours: 1 })),
    }) as unknown as PlanItem;
    const { bars, rows } = layoutBars([
      it('g:1', 'backlog', [['2026-01-01', '2026-01-10']]), it('g:2', 'backlog', [['2026-01-11', '2026-01-12']]), it('g:3', 'backlog', [['2026-01-13', '2026-01-13']]),
      it('p:1', 'release', [['2026-01-05', '2026-01-11']]),
    ], r26);
    expect(rows).toEqual({ release: 1, queue: 1 });
    const q = bars.filter((b) => b.lane === 'queue');
    expect(q.map((b) => [b.key, b.row, b.startDay, b.endDay, b.alt])).toEqual([['g:1', 0, 0, 9, 0], ['g:2', 0, 10, 11, 1], ['g:3', 0, 12, 12, 0]]);
  });
  it('пересечение по дням даёт вторую строку; несколько сегментов', () => {
    const it = (key: string, kind: string, segs: [string, string][]) => ({
      ...e(key, { kind }), start: segs[0][0], end: segs[segs.length - 1][1], days: 1, shiftedDays: 0, queuePosition: 1,
      segments: segs.map(([from, to]) => ({ from, to, days: 1, hours: 1 })),
    }) as unknown as PlanItem;
    const { bars, rows } = layoutBars([
      it('p:1', 'release', [['2026-01-05', '2026-01-11']]), it('p:2', 'release', [['2026-01-10', '2026-01-12']]),
      it('g:2', 'backlog', [['2026-01-05', '2026-01-05'], ['2026-01-12', '2026-01-18']]),
    ], r26);
    expect(rows).toEqual({ release: 2, queue: 1 });
    expect(bars.filter((b) => b.key === 'g:2').map((b) => b.segIndex)).toEqual([0, 1]);
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
  it('состояние по всем записям: externalId и plannedId, пометки каталога только пока список не загружен', () => {
    const rec = (id: number, ext: string | null, status: 'planned' | 'cancelled' | 'done') => ({ id, externalId: ext, status });
    expect(upcomingState(c('1'), null)).toEqual({ state: 'new', plannedId: null });
    expect(upcomingState(c('1', { planned: true, plannedId: 5 }), null)).toEqual({ state: 'planned', plannedId: 5 });
    // кандидат загружен ДО добавления (plannedId=null), запись появилась позже: ищем по externalId
    expect(upcomingState(c('1'), [rec(5, '1', 'planned')])).toEqual({ state: 'planned', plannedId: 5 });
    // убрали из плана: cancelled = «Не распределено», plannedId для «Вернуть»
    expect(upcomingState(c('1', { planned: true, plannedId: 5 }), [rec(5, '1', 'cancelled')])).toEqual({ state: 'unallocated', plannedId: 5 });
    // запись без externalId (ручная правка) находится по plannedId
    expect(upcomingState(c('1', { plannedId: 5 }), [rec(5, null, 'cancelled')]).state).toBe('unallocated');
    // удалена совсем: можно добавить заново, даже если пометка каталога устарела
    expect(upcomingState(c('1', { planned: true, plannedId: 5 }), [])).toEqual({ state: 'new', plannedId: null });
    expect(upcomingState(c('1'), [rec(5, '1', 'done')]).state).toBe('planned');
  });
  it('подсказка «на позицию»', () => {
    const f = (o: Record<string, unknown>) => ({ key: 'g:1', reason: 'no_capacity', ...o }) as unknown as Parameters<typeof insertHint>[0];
    expect(insertHint(f({}))).toBeNull();
    expect(insertHint(f({ insertAt: null, displacesAtInsert: null }))).toBeNull(); // проба не считалась
    expect(insertHint(f({ insertAt: null, displacesAtInsert: 0 }))).toEqual({ kind: 'never', line: 'Нигде не влезет: слишком длинная или мешают релизы' });
    expect(insertHint(f({ insertAt: 3, displacesAtInsert: 0, displacedTitles: [] }))).toMatchObject({ kind: 'insert', at: 3, warn: false, line: 'Влезет на позиции 3, никого не вытеснит' });
    expect(insertHint(f({ insertAt: 2, displacesAtInsert: 2, displacedTitles: ['А', 'Б'] }))).toMatchObject({ warn: true, line: 'Влезет на позиции 2, вытеснит 2: «А», «Б»' });
    expect(insertHint({ ...f({ insertAt: 2, displacesAtInsert: 0 }), key: 'p:1' })).toBeNull();
    expect(insertHint(f({ insertAt: 2, displacesAtInsert: 0, reason: 'after_year_end' }))).toBeNull();
  });
  it('вставка игры на позицию по ключам сохраняет остальной порядок', () => {
    expect(orderWithAtPosition(['g:1', 'g:2', 'g:3', 'g:4'], 'g:4', 2)).toEqual(['g:1', 'g:4', 'g:2', 'g:3']);
    expect(orderWithAtPosition(['g:1', 'g:2', 'g:3'], 'g:1', 3)).toEqual(['g:2', 'g:3', 'g:1']);
    expect(orderWithAtPosition(['g:1', 'g:2'], 'g:9', 1)).toEqual(['g:1', 'g:2']);
    expect(orderWithAtPosition(['g:1', 'g:2', 'g:3'], 'g:3', 99)).toEqual(['g:1', 'g:2', 'g:3']);
  });
  it('тост после «Убрать из плана»', () => {
    expect(removedToast(3, 1)).toBe('Убрано из плана. Не успеваю: было 3, стало 1');
    expect(removedToast(0, 0)).toBe('Убрано из плана');
    expect(placedToast(2, 3, 2)).toBe('Поставлено на позицию 2. Не успеваю: было 3, стало 2');
  });
  it('тело POST: галка на релизе по умолчанию, часы пустые', () => {
    expect(upcomingBody(c('9'))).toEqual({ title: 'T9', releaseDate: '2026-12-01', coverUrl: null, wantAtRelease: true, hoursManual: null, externalSource: 'rawg', externalId: '9' });
  });
  it('страницы дописываются без повторов', () => {
    expect(appendUnique([c('1'), c('2')], [c('2'), c('3')]).map((x) => x.externalId)).toEqual(['1', '2', '3']);
  });
});

describe('единое расписание', () => {
  const mk = (key: string, start: string, o: Record<string, unknown> = {}) => ({ ...e(key, o), start, end: start, days: 1, shiftedDays: 0, queuePosition: null, segments: [] });
  const d = {
    queue: [{ key: 'g:1', state: 'scheduled' }, { key: 'g:2', state: 'scheduled' }, { key: 'g:3', state: 'not_fit' }, { key: 'g:4', state: 'need_hours' }, { key: 'p:9', state: 'scheduled' }],
    items: [
      mk('g:1', '2026-01-01', { queuePosition: 1 }), mk('g:2', '2026-03-09', { queuePosition: 2 }),
      mk('p:7', '2026-01-28', { kind: 'release', wantAtRelease: true }), mk('p:9', '2026-03-09', { releaseDate: '2026-03-01', queuePosition: 5 }),
    ],
    notFit: [{ ...e('g:3'), reason: 'no_capacity', hoursShort: 1 }],
    needHours: [e('g:4', { hours: null })],
  } as unknown as Parameters<typeof buildSchedule>[0];
  it_('по start, релиз раньше при равенстве, not_fit скрыт, без дат в конце', () => {
    expect(buildSchedule(d, null).map((r) => r.key)).toEqual(['g:1', 'p:7', 'p:9', 'g:2', 'g:4']);
  });
  it_('релиз без часов стоит по дате выхода между играми, без даты и без часов в расписание не попадает', () => {
    const d2 = {
      ...d,
      needHours: [e('g:4', { hours: null }), e('p:30', { kind: 'release', hours: null, hoursSource: null, releaseDate: '2026-02-01', wantAtRelease: true }), e('p:31', { kind: 'release', hours: null, hoursSource: null, releaseDate: null })],
    } as unknown as Parameters<typeof buildSchedule>[0];
    const rows = buildSchedule(d2, null);
    expect(rows.map((r) => r.key)).toEqual(['g:1', 'p:7', 'p:30', 'p:9', 'g:2', 'g:4']);
    expect(rows[2]).toMatchObject({ state: 'need_hours', item: null, movable: false });
    expect([...backlogPositions(rows)].map(([k]) => k)).toEqual(['g:1', 'g:2', 'g:4']);
  });
  it_('номера и порядок считаются только по g:*', () => {
    const rows = buildSchedule(d, null);
    expect([...backlogPositions(rows)]).toEqual([['g:1', 1], ['g:2', 2], ['g:4', 3]]);
    expect(backlogKeys(rows)).toEqual(['g:1', 'g:2', 'g:4']);
  });
  it_('локальный порядок переставляет g:* между своими местами, релизы остаются', () => {
    expect(buildSchedule(d, ['g:2', 'g:4', 'g:1', 'g:3']).map((r) => r.key)).toEqual(['g:2', 'p:7', 'p:9', 'g:4', 'g:1']);
  });
  it_('drop-цель среди g:*, релизная строка не цель', () => {
    const rows = buildSchedule(d, null);
    expect(dropOrder(rows, 'g:2', 'g:1', 'before')).toEqual(['g:2', 'g:1', 'g:4']);
    expect(dropOrder(rows, 'g:1', 'p:7', 'after')).toBeNull();
    expect(dropOrder(rows, 'g:1', 'g:2', 'before')).toBeNull();
    expect(mergeVisibleOrder(['g:1', 'g:2', 'g:3', 'g:4'], dropOrder(rows, 'g:4', 'g:1', 'before') as string[])).toEqual(['g:4', 'g:1', 'g:3', 'g:2']);
  });
});

describe('Пакет 6, п. 11: paceView', () => {
  const base = { status: 'ok' as const, from: '2026-10-14', to: '2026-11-10', days: 28, playedHours: 28, hoursPerWeek: 7, games: 3, unknownGames: 1, backlogHours: 70, weeks: 10, closeDate: '2027-01-19' };
  it('ok: месяц и год, темп, остаток, игры без длительности', () => {
    expect(paceView(base)).toEqual({ kind: 'ok', title: 'Бэклог закончится ≈ в январе 2027', note: 'В темпе последних 4 недель: 7 ч в неделю, в бэклоге 70 ч. У 1 игры нет длительности — она не учтена.' });
    expect(paceView({ ...base, days: 15, unknownGames: 0, hoursPerWeek: 3.5 })?.note).toBe('В темпе последних 15 дней: 3,5 ч в неделю, в бэклоге 70 ч.');
    expect(paceView({ ...base, unknownGames: 2 })?.note).toContain('У 2 игр нет длительности — они не учтены.');
    expect(paceView({ ...base, weeks: 6000, closeDate: '2141-01-01' })?.title).toBe('Бэклог закончится больше чем через 100 лет');
  });
  it('нет прогноза: пусто, без длительностей, мало истории, не играл; старый ответ', () => {
    expect(paceView({ ...base, status: 'empty' })?.title).toBe('Бэклог пуст');
    expect(paceView({ ...base, status: 'no_hours' })?.title).toBe('Прогноза нет: у игр бэклога нет длительности');
    expect(paceView({ ...base, status: 'no_data' })?.title).toBe('Прогноз появится через неделю истории часов');
    expect(paceView({ ...base, status: 'no_pace', unknownGames: 0 })).toEqual({ kind: 'info', title: 'За последние 4 недели игр не было — темп не посчитать', note: 'В бэклоге 70 ч.' });
    expect(paceView({ ...base, status: 'no_pace', days: 21 })?.title).toBe('За последние 21 день игр не было — темп не посчитать');
    expect(paceView(undefined)).toBeNull();
  });
});
