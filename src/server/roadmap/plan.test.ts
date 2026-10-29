import { describe, expect, it } from 'vitest';
import { dayNum, isDateString, weekdayMon0, weeksOfYear } from './dates';
import { buildPlan, plannedHoursBetween, queueDays, releaseWeeks } from './plan';
import type { RoadmapEntry } from './types';

const bl = (id: number, hours: number | null, title = `B${id}`): RoadmapEntry => ({
  key: `g:${id}`, kind: 'backlog', gameId: id, plannedId: null, title, coverUrl: null, hours,
  hoursSource: hours === null ? null : 'hltb', releaseDate: null, wantAtRelease: false,
});
const rel = (id: number, date: string, hours: number | null, want = true): RoadmapEntry => ({
  key: `p:${id}`, kind: want ? 'release' : 'planned', gameId: null, plannedId: id, title: `R${id}`, coverUrl: null, hours,
  hoursSource: hours === null ? null : 'manual', releaseDate: date, wantAtRelease: want,
});
const plan = (backlog: RoadmapEntry[], planned: RoadmapEntry[] = [], hoursPerWeek: number | null = 10, year = 2026) =>
  buildPlan({ year, hoursPerWeek, backlog, planned });
const item = (p: ReturnType<typeof plan>, key: string) => p.items.find((i) => i.key === key);

describe('даты', () => {
  it('день недели и валидация', () => {
    expect(weekdayMon0(dayNum('2026-01-01'))).toBe(3); // четверг
    expect(weekdayMon0(dayNum('2024-01-01'))).toBe(0); // понедельник
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('2024-02-29')).toBe(true);
    expect(isDateString('2026-2-3')).toBe(false);
  });
  it('границы года: недели МСК с понедельника, обрезаны 1 янв и 31 дек', () => {
    const w = weeksOfYear(2026);
    expect(w).toHaveLength(53);
    expect(w[0]).toEqual({ index: 1, from: '2026-01-01', to: '2026-01-04', days: 4 });
    expect(w[1].from).toBe('2026-01-05');
    expect(w[52]).toEqual({ index: 53, from: '2026-12-28', to: '2026-12-31', days: 4 });
    expect(w.reduce((n, x) => n + x.days, 0)).toBe(365);
    const w24 = weeksOfYear(2024);
    expect(w24[0].days).toBe(7);
    expect(w24[w24.length - 1]).toMatchObject({ from: '2024-12-30', to: '2024-12-31', days: 2 });
    expect(w24.reduce((n, x) => n + x.days, 0)).toBe(366);
  });
});

describe('формулы', () => {
  it('недели релиза и дни очереди', () => {
    expect(releaseWeeks(20, 10)).toBe(2);
    expect(releaseWeeks(20.1, 10)).toBe(3);
    expect(releaseWeeks(0.5, 10)).toBe(1);
    expect(releaseWeeks(0.3, 0.1)).toBe(3);
    expect(queueDays(10, 10)).toBe(7);
    expect(queueDays(10.1, 10)).toBe(8);
  });
});

describe('релизы', () => {
  it('релиз с галкой ставится на дату выхода на ceil(часы/бюджет) недель', () => {
    const p = plan([], [rel(1, '2026-03-02', 20)]);
    const it1 = item(p, 'p:1');
    expect(it1).toMatchObject({ start: '2026-03-02', end: '2026-03-15', days: 14, shiftedDays: 0, queuePosition: null, kind: 'release' });
    expect(it1?.segments).toEqual([{ from: '2026-03-02', to: '2026-03-15', days: 14, hours: 20 }]);
    expect(p.conflicts).toEqual([]);
    expect(p.notFit).toEqual([]);
    expect(p.queue).toEqual([]);
  });

  it('релиз до начала года: окно от реальной даты, прошлая часть это конфликт starts_before_year', () => {
    const p = plan([], [rel(1, '2025-12-30', 30)]); // 3 недели: 30.12..19.01, в 2026 остаётся 19 дней
    expect(item(p, 'p:1')).toMatchObject({ start: '2026-01-01', end: '2026-01-19', days: 19, shiftedDays: 0 });
    expect(item(p, 'p:1')?.segments[0].hours).toBeCloseTo(30 * 19 / 21, 1);
    expect(p.conflicts).toEqual([{ reason: 'starts_before_year', from: '2025-12-30', to: '2025-12-31', keys: ['p:1'] }]);
  });

  it('релиз целиком в прошлом году: в план не ставится, конфликт на всё окно', () => {
    const p = plan([], [rel(1, '2025-11-01', 10)]);
    expect(p.items).toEqual([]);
    expect(p.conflicts).toEqual([{ reason: 'starts_before_year', from: '2025-11-01', to: '2025-11-07', keys: ['p:1'] }]);
  });

  it('два релиза пересекаются: второй сдвинут, конфликт с промежутком и обеими играми', () => {
    const p = plan([], [rel(1, '2026-03-02', 20), rel(2, '2026-03-10', 10)]);
    expect(item(p, 'p:1')).toMatchObject({ start: '2026-03-02', end: '2026-03-15' });
    expect(item(p, 'p:2')).toMatchObject({ start: '2026-03-16', end: '2026-03-22', shiftedDays: 6 });
    expect(p.conflicts).toEqual([{ reason: 'release_overlap', from: '2026-03-10', to: '2026-03-15', keys: ['p:1', 'p:2'] }]);
    expect(p.notFit).toEqual([]);
  });

  it('цепочка: третий релиз блокируют оба предыдущих', () => {
    const p = plan([], [rel(1, '2026-03-02', 20), rel(2, '2026-03-04', 10), rel(3, '2026-03-05', 10)]);
    expect(item(p, 'p:3')?.start).toBe('2026-03-23');
    expect(p.conflicts).toHaveLength(2);
    expect(p.conflicts[1]).toEqual({ reason: 'release_overlap', from: '2026-03-05', to: '2026-03-22', keys: ['p:1', 'p:2', 'p:3'] });
  });

  it('одна и та же дата релиза: порядок по ключу, детерминированно', () => {
    const p = plan([], [rel(2, '2026-03-02', 10), rel(1, '2026-03-02', 10)]);
    expect(item(p, 'p:1')?.start).toBe('2026-03-02');
    expect(item(p, 'p:2')?.start).toBe('2026-03-09');
  });

  it('релиз у конца года не влезает: notFit и конфликт exceeds_year_end', () => {
    const p = plan([], [rel(1, '2026-12-25', 30)]);
    expect(p.items).toEqual([]);
    expect(p.notFit).toEqual([expect.objectContaining({ key: 'p:1', reason: 'exceeds_year_end', hoursShort: 20 })]);
    expect(p.conflicts).toEqual([{ reason: 'exceeds_year_end', from: '2026-12-25', to: '2026-12-31', keys: ['p:1'] }]);
  });

  it('окно выходит за год, но часы помещаются в оставшиеся дни: ставится обрезанным + конфликт', () => {
    const p = plan([], [rel(1, '2026-12-27', 7)]);
    expect(item(p, 'p:1')).toMatchObject({ start: '2026-12-27', end: '2026-12-31', days: 5 });
    expect(p.notFit).toEqual([]);
    expect(p.conflicts).toEqual([{ reason: 'exceeds_year_end', from: '2026-12-27', to: '2026-12-31', keys: ['p:1'] }]);
  });

  it('релиз после конца года: notFit after_year_end без конфликта', () => {
    const p = plan([], [rel(1, '2027-01-01', 10)]);
    expect(p.notFit).toEqual([expect.objectContaining({ key: 'p:1', reason: 'after_year_end', hoursShort: null })]);
    expect(p.conflicts).toEqual([]);
  });

  it('релиз, сдвинутый за конец года предыдущим: notFit, конфликт до 31 декабря', () => {
    const p = plan([], [rel(1, '2026-12-01', 40), rel(2, '2026-12-20', 10)]);
    expect(item(p, 'p:1')).toMatchObject({ start: '2026-12-01', end: '2026-12-28' });
    expect(p.conflicts.find((c) => c.reason === 'release_overlap')).toMatchObject({ from: '2026-12-20', to: '2026-12-28', keys: ['p:1', 'p:2'] });
    // второй стартует 29 декабря: окно 7 дней, в году 3 дня = 4.3 ч < 10
    expect(p.notFit).toEqual([expect.objectContaining({ key: 'p:2', reason: 'exceeds_year_end' })]);
  });
});

describe('очередь бэклога', () => {
  it('заполняет свободные дни по порядку', () => {
    const p = plan([bl(1, 10), bl(2, 5), bl(3, 20)]);
    expect(item(p, 'g:1')).toMatchObject({ start: '2026-01-01', end: '2026-01-07', days: 7, queuePosition: 1 });
    expect(item(p, 'g:2')).toMatchObject({ start: '2026-01-08', end: '2026-01-11', days: 4, queuePosition: 2 }); // ceil(3.5) = 4
    expect(item(p, 'g:3')).toMatchObject({ start: '2026-01-12', end: '2026-01-25', days: 14, queuePosition: 3 });
    expect(p.queue.map((q) => q.key)).toEqual(['g:1', 'g:2', 'g:3']);
  });

  it('игру очереди релиз не разрывает: короткое окно пропускается, игра целиком после релиза', () => {
    // релиз 5..11 янв; свободно 1..4 (4 дня). Игра 1 (10 ч = 7 дней) не влезает в окно 1..4 и встаёт после релиза.
    const p = plan([bl(1, 10), bl(2, 5)], [rel(9, '2026-01-05', 7)]);
    expect(item(p, 'p:9')).toMatchObject({ start: '2026-01-05', end: '2026-01-11' });
    const g1 = item(p, 'g:1');
    expect(g1?.segments).toEqual([{ from: '2026-01-12', to: '2026-01-18', days: 7, hours: 10 }]);
    // игра 2 (5 ч = 4 дня) ищет окно после предыдущей игры очереди, а не возвращается в пропущенное
    expect(item(p, 'g:2')).toMatchObject({ start: '2026-01-19', end: '2026-01-22' });
    for (const i of p.items) expect(i.segments).toHaveLength(1);
  });

  it('короткая игра влезает в окно перед релизом, длинная после него', () => {
    const p = plan([bl(2, 5), bl(1, 10)], [rel(9, '2026-01-05', 7)]);
    expect(item(p, 'g:2')).toMatchObject({ start: '2026-01-01', end: '2026-01-04' });
    expect(item(p, 'g:1')).toMatchObject({ start: '2026-01-12', end: '2026-01-18' });
  });

  it('релиз в прошлом при занятых неделях: сдвиг и конфликт', () => {
    const p = plan([], [rel(1, '2026-02-02', 20), rel(2, '2026-02-03', 5)]);
    expect(p.conflicts).toEqual([{ reason: 'release_overlap', from: '2026-02-03', to: '2026-02-15', keys: ['p:1', 'p:2'] }]);
    expect(item(p, 'p:2')?.shiftedDays).toBe(13);
  });

  it('не влезла в год: notFit, а следующая короткая ставится', () => {
    const p = plan([bl(1, 1000), bl(2, 10)]);
    expect(p.notFit).toEqual([expect.objectContaining({ key: 'g:1', reason: 'no_capacity' })]);
    expect(p.notFit[0].hoursShort).toBeGreaterThan(400);
    expect(item(p, 'g:2')).toMatchObject({ start: '2026-01-01', queuePosition: 2 });
    expect(p.queue).toEqual([{ key: 'g:1', state: 'not_fit' }, { key: 'g:2', state: 'scheduled' }]);
  });

  it('игра без часов: needHours, в план не попадает, место в очереди остаётся', () => {
    const p = plan([bl(1, null), bl(2, 0), bl(3, 10)], [rel(5, '2026-05-01', null)]);
    expect(p.needHours.map((e) => e.key)).toEqual(['g:1', 'g:2', 'p:5']);
    expect(p.items.map((i) => i.key)).toEqual(['g:3']);
    expect(item(p, 'g:3')?.queuePosition).toBe(3);
    expect(p.queue.map((q) => q.state)).toEqual(['need_hours', 'need_hours', 'scheduled']);
    expect(p.notFit).toEqual([]);
  });

  it('planned без галки идёт после бэклога и не раньше даты выхода', () => {
    const p = plan([bl(1, 10)], [rel(7, '2026-06-01', 10, false), rel(8, '2026-02-01', 10, false)]);
    expect(item(p, 'g:1')?.start).toBe('2026-01-01');
    expect(item(p, 'p:8')).toMatchObject({ start: '2026-02-01', queuePosition: 2, kind: 'planned' });
    expect(item(p, 'p:7')).toMatchObject({ start: '2026-06-01', queuePosition: 3 });
    expect(p.queue.map((q) => q.key)).toEqual(['g:1', 'p:8', 'p:7']);
  });
});

describe('пустой год и бюджет', () => {
  it('пустой год: ok, 53 недели, 12 месяцев, ёмкость = бюджет * дни / 7', () => {
    const p = plan([]);
    expect(p.status).toBe('ok');
    expect(p.items).toEqual([]);
    expect(p.weeks).toHaveLength(53);
    expect(p.months).toHaveLength(12);
    expect(p.totals).toEqual({ capacityHours: 521.4, plannedHours: 0 });
    expect(p.weeks[0].capacityHours).toBe(5.7);
    expect(p.months[1].capacityHours).toBe(40); // февраль 2026: 28 дней
    expect(p.weeks.every((w) => w.plannedHours === 0 && w.items.length === 0)).toBe(true);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 169, null])('бюджет %s: no_budget, план пуст, needHours считается', (b) => {
    const p = plan([bl(1, 10), bl(2, null)], [rel(3, '2026-03-01', 5)], b);
    expect(p.status).toBe('no_budget');
    expect(p.items).toEqual([]);
    expect(p.conflicts).toEqual([]);
    expect(p.notFit).toEqual([]);
    expect(p.needHours.map((e) => e.key)).toEqual(['g:2']);
    expect(p.queue).toEqual([{ key: 'g:1', state: 'unplanned' }, { key: 'g:2', state: 'need_hours' }]);
    expect(p.totals).toEqual({ capacityHours: 0, plannedHours: 0 });
  });

  it('бюджет 168 допустим, 0.1 допустим', () => {
    expect(plan([bl(1, 10)], [], 168).status).toBe('ok');
    const p = plan([bl(1, 1)], [], 0.1);
    expect(p.status).toBe('ok');
    expect(item(p, 'g:1')?.days).toBe(70);
  });
});

describe('нагрузка по неделям и месяцам', () => {
  it('часы игры суммируются по неделям и месяцам без потерь', () => {
    const p = plan([bl(1, 35), bl(2, 14)], [rel(9, '2026-02-20', 15)]);
    for (const key of ['g:1', 'g:2', 'p:9']) {
      const hours = (p.items.find((i) => i.key === key)?.hours ?? 0);
      const byWeek = p.weeks.reduce((n, w) => n + (w.items.find((x) => x.key === key)?.hours ?? 0), 0);
      const byMonth = p.months.reduce((n, m) => n + (m.items.find((x) => x.key === key)?.hours ?? 0), 0);
      expect(byWeek).toBeCloseTo(hours, 0);
      expect(byMonth).toBeCloseTo(hours, 0);
    }
    expect(p.totals.plannedHours).toBe(64);
    // нагрузка недели не превышает ёмкость (допуск на округление)
    for (const w of p.weeks) expect(w.plannedHours).toBeLessThanOrEqual(w.capacityHours + 0.15);
  });

  it('plannedHoursBetween: период по датам', () => {
    const p = plan([bl(1, 10)]); // 1 янв..7 янв, 7 дней, 10/7 ч в день
    expect(plannedHoursBetween(p.items, '2026-01-01', '2026-01-07')).toBeCloseTo(10, 6);
    expect(plannedHoursBetween(p.items, '2026-01-01', '2026-01-03')).toBeCloseTo(30 / 7, 6);
    expect(plannedHoursBetween(p.items, '2026-02-01', '2026-02-10')).toBe(0);
  });

  it('високосный год и ключи не пересекаются между годами', () => {
    const p = plan([bl(1, 10)], [], 10, 2024);
    expect(p.range).toEqual({ from: '2024-01-01', to: '2024-12-31', days: 366 });
    expect(p.weeks[0].days).toBe(7);
  });
});
