// QA Фазы 12: адверсариальные проверки алгоритма плана, прогресса и «сегодня» по МСК.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { groupSnapshots } from '@/server/stats/hours';
import { dayNum, weeksOfYear } from './dates';
import { getRoadmap, putSettings, saveOrder } from './db';
import { buildPlan, isValidBudget } from './plan';
import { computeProgress } from './progress';
import { parseSettingsBody, parseOrderBody, parseCatalogQuery } from './validation';
import type { RoadmapEntry } from './types';

const bl = (id: number, hours: number | null): RoadmapEntry => ({
  key: `g:${id}`, kind: 'backlog', gameId: id, plannedId: null, title: `B${id}`, coverUrl: null, hours,
  hoursSource: hours === null ? null : 'hltb', releaseDate: null, wantAtRelease: false,
});
const rel = (id: number, date: string, hours: number | null, want = true): RoadmapEntry => ({
  key: `p:${id}`, kind: want ? 'release' : 'planned', gameId: null, plannedId: id, title: `R${id}`, coverUrl: null, hours,
  hoursSource: hours === null ? null : 'manual', releaseDate: date, wantAtRelease: want,
});
const plan = (backlog: RoadmapEntry[], planned: RoadmapEntry[] = [], b: number | null = 10, year = 2026) => buildPlan({ year, hoursPerWeek: b, backlog, planned });

describe('QA: граница года и бюджет', () => {
  it('релиз 31 декабря, 1 неделя окна: конфликт exceeds_year_end и «Не успеваю» с нехваткой часов', () => {
    const p = plan([], [rel(1, '2026-12-31', 10)]);
    expect(p.items).toHaveLength(0);
    expect(p.notFit[0]).toMatchObject({ key: 'p:1', reason: 'exceeds_year_end' });
    expect(p.notFit[0].hoursShort).toBeGreaterThan(8);
    expect(p.conflicts).toEqual([{ reason: 'exceeds_year_end', from: '2026-12-31', to: '2026-12-31', keys: ['p:1'] }]);
  });
  it('релиз 1 января 2027 для плана 2026: after_year_end; 1 января 2026: ставится с первого дня', () => {
    expect(plan([], [rel(1, '2027-01-01', 5)]).notFit[0].reason).toBe('after_year_end');
    expect(plan([], [rel(1, '2026-01-01', 5)]).items[0].start).toBe('2026-01-01');
  });
  it('релиз 29 февраля високосного года ставится ровно в этот день; в невисокосном дата невалидна', () => {
    const p = plan([], [rel(1, '2028-02-29', 10)], 10, 2028);
    expect(p.items[0]).toMatchObject({ start: '2028-02-29', end: '2028-03-06' });
    expect(p.range.days).toBe(366);
    expect(weeksOfYear(2028).reduce((n, w) => n + w.days, 0)).toBe(366);
  });
  it('релиз до начала года (N-1): окно от реальной даты 20.12..09.01, в плане 9 дней, прошлая часть в конфликте', () => {
    const p = plan([], [rel(1, '2025-12-20', 30)]);
    expect(p.items[0]).toMatchObject({ start: '2026-01-01', end: '2026-01-09', days: 9, shiftedDays: 0 });
    expect(p.conflicts).toEqual([{ reason: 'starts_before_year', from: '2025-12-20', to: '2025-12-31', keys: ['p:1'] }]);
    expect(p.totals.plannedHours).toBeCloseTo(12.9, 1);
  });
  it('два релиза в один день: детерминированно по ключу, второй после первого, конфликт с обоими ключами', () => {
    const a = plan([], [rel(2, '2026-03-02', 10), rel(1, '2026-03-02', 10)]);
    const b = plan([], [rel(1, '2026-03-02', 10), rel(2, '2026-03-02', 10)]);
    expect(a).toEqual(b);
    expect(a.items.map((i) => i.key)).toEqual(['p:1', 'p:2']);
    expect(a.conflicts).toHaveLength(1);
    expect(a.conflicts[0].keys.sort()).toEqual(['p:1', 'p:2']);
    expect(a.conflicts[0].from).toBe('2026-03-02');
  });
  it('релиз без часов (hours_manual null): needHours, не в плане, конфликтов нет', () => {
    const p = plan([], [rel(1, '2026-03-02', null)]);
    expect(p.items).toHaveLength(0);
    expect(p.needHours.map((e) => e.key)).toEqual(['p:1']);
    expect(p.conflicts).toEqual([]);
    expect(p.notFit).toEqual([]);
  });
  it.each([0, -1, NaN, Infinity, 169, null, undefined])('бюджет %s: no_budget, items пусты', (b) => {
    const p = buildPlan({ year: 2026, hoursPerWeek: b as number, backlog: [bl(1, 5)], planned: [] });
    expect(p.status).toBe('no_budget');
    expect(p.items).toEqual([]);
    expect(p.totals.capacityHours).toBe(0);
  });
  it('isValidBudget: строка и boolean не годятся', () => {
    expect(isValidBudget('10')).toBe(false);
    expect(isValidBudget(true)).toBe(false);
    expect(isValidBudget(3.3)).toBe(true);
  });
  it('дробный бюджет 3.3: 10 ч = ceil(7*10/3.3)=22 дня', () => {
    const p = plan([bl(1, 10)], [], 3.3);
    expect(p.items[0].days).toBe(22);
  });
  it('игра длиннее года: no_capacity с нехваткой часов, остальные ставятся', () => {
    const p = plan([bl(1, 5000), bl(2, 5)]);
    expect(p.notFit.map((e) => [e.key, e.reason])).toEqual([['g:1', 'no_capacity']]);
    expect(p.notFit[0].hoursShort).toBeGreaterThan(4000);
    expect(p.items.map((i) => i.key)).toEqual(['g:2']);
    expect(p.queue.map((q) => q.state)).toEqual(['not_fit', 'scheduled']);
  });
  it('пустая очередь и пустой planned: ok, пустые списки', () => {
    const p = plan([]);
    expect(p).toMatchObject({ status: 'ok', items: [], queue: [], conflicts: [], notFit: [], needHours: [] });
  });
  it('релиз без галки не раньше даты выхода и не входит в конфликты; не влез - «Не успеваю», пометки «не в плане» нет', () => {
    const p = plan([bl(1, 5)], [rel(7, '2026-06-01', 10, false), rel(8, '2026-12-30', 500, false)]);
    expect(p.items.find((i) => i.key === 'p:7')!.start >= '2026-06-01').toBe(true);
    expect(p.notFit.map((e) => e.key)).toEqual(['p:8']);
    expect(p.queue.map((q) => q.state)).not.toContain('not_in_plan');
  });
});

describe('QA: свойства на случайных входах', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  it('300 случайных планов: игры не пересекаются, сегмент один, нагрузка недели не выше ёмкости, дни в границах года', () => {
    for (let n = 0; n < 300; n++) {
      const year = [2026, 2028, 2027][n % 3];
      const budget = Math.round((0.5 + rnd() * 40) * 10) / 10;
      const backlog = Array.from({ length: Math.floor(rnd() * 30) }, (_, i) => bl(i + 1, rnd() < 0.15 ? null : Math.round(rnd() * 120 * 10) / 10 + 0.1));
      const planned = Array.from({ length: Math.floor(rnd() * 8) }, (_, i) => {
        const d = new Date(Date.UTC(year - 1, 10, 1) + Math.floor(rnd() * 500) * 86400000).toISOString().slice(0, 10);
        return rel(i + 1, d, rnd() < 0.2 ? null : Math.round(rnd() * 80 * 10) / 10 + 0.1, rnd() < 0.6);
      });
      const p = buildPlan({ year, hoursPerWeek: budget, backlog, planned });
      const used = new Set<number>();
      for (const it of p.items) {
        expect(it.segments).toHaveLength(1);
        expect(it.start >= p.range.from && it.end <= p.range.to).toBe(true);
        for (let d = dayNum(it.start); d <= dayNum(it.end); d++) {
          expect(used.has(d), `пересечение ${it.key} n=${n}`).toBe(false);
          used.add(d);
        }
      }
      for (const w of p.weeks) expect(w.plannedHours).toBeLessThanOrEqual(w.capacityHours + 0.15);
      const keys = [...p.items.map((i) => i.key), ...p.notFit.map((e) => e.key), ...p.needHours.map((e) => e.key)];
      expect(new Set(keys).size).toBe(keys.length); // каждая игра ровно в одном месте
      expect(p.months.reduce((s, m) => s + m.plannedHours, 0)).toBeCloseTo(p.totals.plannedHours, 0);
    }
  });
  it('1000 маленьких игр: быстро, ровно 365 дней заполнено, остальные в notFit', () => {
    const t0 = Date.now();
    const p = plan(Array.from({ length: 1000 }, (_, i) => bl(i + 1, 1)), [], 7);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(p.items).toHaveLength(365);
    expect(p.notFit).toHaveLength(635);
  });
});

describe('QA: прогресс и МСК', () => {
  const p0 = plan([bl(1, 70)]);
  const by = groupSnapshots([{ gameId: 1, date: '2025-12-31', seconds: 0 }]);
  const base = { plan: p0, firstSnapshotDate: '2025-12-31', by, hoursPerWeek: 10, planGameIds: new Set([1]) };
  it('1 января: asOf = 31 декабря прошлого года, not_started', () => {
    expect(computeProgress({ ...base, today: '2026-01-01' })).toMatchObject({ status: 'not_started', asOf: '2025-12-31' });
  });
  it('2 января: считается только 1 января', () => {
    const r = computeProgress({ ...base, today: '2026-01-02' });
    expect(r).toMatchObject({ asOf: '2026-01-01', from: '2026-01-01' });
    expect(r!.plannedHours).toBeCloseTo(1.4, 1);
  });
  it('1 января следующего года: asOf = 31 декабря, весь год', () => {
    const r = computeProgress({ ...base, today: '2027-01-01' });
    expect(r!.asOf).toBe('2026-12-31');
  });
  it('допуск ровно 2 ч: onTrack, 2.1 ч: behind', () => {
    const mk = (h: number) => groupSnapshots([{ gameId: 1, date: '2025-12-31', seconds: 0 }, { gameId: 1, date: '2026-01-11', seconds: Math.round(h * 3600) }]);
    // план на 10 дней = 14.3 ч
    expect(computeProgress({ ...base, today: '2026-01-11', by: mk(12.3) })!.status).toBe('onTrack');
    expect(computeProgress({ ...base, today: '2026-01-11', by: mk(12.2) })!.status).toBe('behind');
  });
});

describe('QA: валидация', () => {
  it('настройки: границы', () => {
    for (const b of [{ year: 2026, hoursPerWeek: 0 }, { year: 2026, hoursPerWeek: -1 }, { year: 2026, hoursPerWeek: 168.1 }, { year: 1999, hoursPerWeek: 5 }, { year: 2101, hoursPerWeek: 5 }, { year: 2026.5, hoursPerWeek: 5 }, { year: '2026', hoursPerWeek: 5 }, { year: 2026, hoursPerWeek: '5' }, { year: 2026, hoursPerWeek: 0.04 }, { year: 2026 }, { year: 2026, hoursPerWeek: 5, extra: 1 }]) {
      expect(parseSettingsBody(b).ok, JSON.stringify(b)).toBe(false);
    }
    expect(parseSettingsBody({ year: 2026, hoursPerWeek: 168 }).ok).toBe(true);
    expect(parseSettingsBody({ year: 2026, hoursPerWeek: 0.1 }).ok).toBe(true);
    expect(parseSettingsBody({ year: 2026, hoursPerWeek: 7.25 })).toMatchObject({ ok: true, value: { hoursPerWeek: 7.3 } });
  });
  it('порядок: повторы, нули, дробные, строки, >1000', () => {
    for (const g of [[1, 1], [0], [1.5], ['1'], [-1], Array.from({ length: 1001 }, (_, i) => i + 1), [2147483648]]) expect(parseOrderBody({ gameIds: g }).ok).toBe(false);
    expect(parseOrderBody({ gameIds: [] }).ok).toBe(true);
    expect(parseOrderBody({}).ok).toBe(false);
  });
  it('поиск: длина 1 и 101 отклоняются, пробелы обрезаются', () => {
    expect(parseCatalogQuery(new URLSearchParams('q=a')).ok).toBe(false);
    expect(parseCatalogQuery(new URLSearchParams(`q=${'x'.repeat(101)}`)).ok).toBe(false);
    expect(parseCatalogQuery(new URLSearchParams('q=%20%20a%20%20')).ok).toBe(false);
  });
});

describe('QA: «сегодня» по МСК на БД', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  it('2026-12-31T21:30Z это уже 1 января 2027 по МСК', async () => {
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    const r = await getRoadmap(t.db, TEST_USER, new Date('2026-12-31T21:30:00Z'));
    expect(r.today).toBe('2027-01-01');
  });
  it('2026-12-31T20:59Z ещё 31 декабря', async () => {
    const r = await getRoadmap(t.db, TEST_USER, new Date('2026-12-31T20:59:00Z'));
    expect(r.today).toBe('2026-12-31');
  });
  it('saveOrder([]) не падает, пустая очередь', async () => {
    expect(await saveOrder(t.db, TEST_USER, [])).toEqual([]);
  });
});
