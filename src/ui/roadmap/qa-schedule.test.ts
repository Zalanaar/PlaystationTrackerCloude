// QA (Фаза 12, расписание): адверсариальные случаи buildSchedule / dropOrder / moveBetweenLists.
import { describe, expect, it } from 'vitest';
import { backlogKeys, buildSchedule, dropOrder, mergeVisibleOrder } from './model';
import { moveBetweenLists } from '../collection/backlog';

type D = Parameters<typeof buildSchedule>[0];
const ent = (key: string, o: Record<string, unknown> = {}) => ({
  key, kind: key.startsWith('g:') ? 'backlog' : 'planned', gameId: null, plannedId: null, title: `T${key}`, coverUrl: null,
  hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false, ...o,
});
const it_ = (key: string, start: string, o: Record<string, unknown> = {}) => ({ ...ent(key, o), start, end: start, days: 1, shiftedDays: 0, queuePosition: null, segments: [] });
const mkD = (p: Partial<Record<'queue' | 'items' | 'notFit' | 'needHours', unknown[]>>) => ({ queue: [], items: [], notFit: [], needHours: [], ...p }) as unknown as D;

describe('QA buildSchedule', () => {
  it('пустое расписание', () => { expect(buildSchedule(mkD({}), null)).toEqual([]); expect(buildSchedule(mkD({}), ['g:1'])).toEqual([]); });
  it('300 строк, порядок стабилен и без дублей', () => {
    const q = Array.from({ length: 300 }, (_, i) => ({ key: `g:${i + 1}`, state: 'scheduled' }));
    const items = q.map((x, i) => it_(x.key, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, { queuePosition: i + 1 }));
    const rows = buildSchedule(mkD({ queue: q, items }), null);
    expect(rows).toHaveLength(300);
    expect(new Set(rows.map((r) => r.key)).size).toBe(300);
  });
  it('релиз на границе года (31.12 / 01.01) и равные даты', () => {
    const d = mkD({
      queue: [{ key: 'g:1', state: 'scheduled' }],
      items: [it_('g:1', '2026-12-31', { queuePosition: 1 }), it_('p:1', '2026-12-31', { wantAtRelease: true }), it_('p:2', '2026-01-01', { wantAtRelease: true })],
    });
    expect(buildSchedule(d, null).map((r) => r.key)).toEqual(['p:2', 'p:1', 'g:1']);
  });
  it('релиз в needHours с датой и тот же релиз в items не дублируется', () => {
    const d = mkD({ items: [it_('p:1', '2026-02-01', { releaseDate: '2026-02-01' })], needHours: [ent('p:1', { hours: null, releaseDate: '2026-02-01' })] });
    expect(buildSchedule(d, null).map((r) => r.key)).toEqual(['p:1']);
  });
  it('релиз без даты и без часов не попадает в расписание; игра без часов в конце', () => {
    const d = mkD({ queue: [{ key: 'g:1', state: 'need_hours' }, { key: 'g:2', state: 'scheduled' }], items: [it_('g:2', '2026-05-01')], needHours: [ent('g:1', { hours: null }), ent('p:5', { hours: null })] });
    expect(buildSchedule(d, null).map((r) => r.key)).toEqual(['g:2', 'g:1']);
  });
  it('исключённый/сервис: не в queue и не в items = нет строки', () => {
    expect(buildSchedule(mkD({ queue: [{ key: 'g:1', state: 'no_budget' }] }), null)).toEqual([]);
  });
  it('drop/PUT: полный порядок со скрытым not_fit, релиз между бэклог-строками', () => {
    const d = mkD({
      queue: [{ key: 'g:1', state: 'scheduled' }, { key: 'g:2', state: 'not_fit' }, { key: 'g:3', state: 'scheduled' }, { key: 'g:4', state: 'scheduled' }],
      items: [it_('g:1', '2026-01-01', { queuePosition: 1 }), it_('g:3', '2026-03-01', { queuePosition: 3 }), it_('g:4', '2026-04-01', { queuePosition: 4 }), it_('p:1', '2026-02-01', { wantAtRelease: true })],
      notFit: [{ ...ent('g:2'), reason: 'x', hoursShort: 1 }],
    });
    const rows = buildSchedule(d, null);
    expect(rows.map((r) => r.key)).toEqual(['g:1', 'p:1', 'g:3', 'g:4']);
    const vis = dropOrder(rows, 'g:4', 'g:3', 'before') as string[];
    expect(vis).toEqual(['g:1', 'g:4', 'g:3']);
    expect(mergeVisibleOrder(['g:1', 'g:2', 'g:3', 'g:4'], vis)).toEqual(['g:1', 'g:2', 'g:4', 'g:3']);
    // оптимистичный вид после перестановки: релиз остаётся на месте
    expect(buildSchedule(d, mergeVisibleOrder(['g:1', 'g:2', 'g:3', 'g:4'], vis)).map((r) => r.key)).toEqual(['g:1', 'p:1', 'g:4', 'g:3']);
    expect(backlogKeys(rows)).toEqual(['g:1', 'g:3', 'g:4']);
  });
});

describe('QA moveBetweenLists', () => {
  const g = (id: number, status: 'backlog' | 'service' | null) => ({ id, status });
  it('игра в обоих блоках: удаляется из обоих, дельты верны', () => {
    const r = moveBetweenLists({ backlog: [g(1, 'backlog')], service: [g(1, 'service')] }, g(1, 'backlog'), 'playing');
    expect(r.lists).toEqual({ backlog: [], service: [], shelved: [] });
    expect([r.backlogDelta, r.serviceDelta]).toEqual([-1, -1]);
  });
  it('двойной вызов в сервис не плодит дубль', () => {
    const a = moveBetweenLists({ backlog: [g(1, 'backlog')], service: [] }, g(1, 'backlog'), 'service');
    const b = moveBetweenLists(a.lists, g(1, 'backlog'), 'service');
    expect(b.lists.service).toHaveLength(1);
    expect(a.serviceDelta + b.serviceDelta).toBe(1);
  });
  it('игра вне видимых страниц (300+): дельта не уходит в минус относительно блока', () => {
    const r = moveBetweenLists({ backlog: [], service: [] }, g(9, 'backlog'), 'service');
    expect([r.backlogDelta, r.serviceDelta]).toEqual([0, 1]);
  });
});
