import { describe, expect, it } from 'vitest';
import { groupSnapshots } from '@/server/stats/hours';
import { buildPlan } from './plan';
import { computeProgress, PROGRESS_TOLERANCE_HOURS } from './progress';
import type { RoadmapEntry } from './types';

const g = (id: number, hours: number): RoadmapEntry => ({
  key: `g:${id}`, kind: 'backlog', gameId: id, plannedId: null, title: 'G', coverUrl: null, hours, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false,
});
// 70 ч при 10 ч/нед: 49 дней с 1 января, 10/7 ч в день
const plan = buildPlan({ year: 2026, hoursPerWeek: 10, backlog: [g(1, 70)], planned: [] });
const H = 3600;
const snaps = (list: [string, number][]) => groupSnapshots(list.map(([date, h]) => ({ gameId: 1, date, seconds: h * H })));
const run = (today: string, first: string | null, by: ReturnType<typeof snaps>) => computeProgress({ plan, today, firstSnapshotDate: first, by, hoursPerWeek: 10 });

describe('прогресс', () => {
  it('факт чуть больше плана, но в допуске: onTrack', () => {
    const p = run('2026-01-11', '2025-12-31', snaps([['2025-12-31', 0], ['2026-01-10', 15]]));
    expect(p).toMatchObject({ status: 'onTrack', from: '2026-01-01', asOf: '2026-01-10', plannedHours: 14.3, actualHours: 15, diffHours: 0.7 });
  });

  it('ahead строго: разница больше допуска', () => {
    const p = run('2026-01-11', '2025-12-31', snaps([['2025-12-31', 0], ['2026-01-10', 20]]));
    expect(p?.status).toBe('ahead');
    expect(p?.diffHours).toBe(5.7);
  });

  it('behind: отстаю на N часов', () => {
    const p = run('2026-01-11', '2025-12-31', snaps([['2025-12-31', 0], ['2026-01-10', 3]]));
    expect(p).toMatchObject({ status: 'behind', actualHours: 3, plannedHours: 14.3, diffHours: -11.3, budgetHours: 14.3 });
  });

  it('onTrack: в пределах допуска', () => {
    const p = run('2026-01-11', '2025-12-31', snaps([['2025-12-31', 0], ['2026-01-10', 14.3 - PROGRESS_TOLERANCE_HOURS + 0.5]]));
    expect(p?.status).toBe('onTrack');
  });

  it('сегодняшний день в план не входит', () => {
    const p = run('2026-01-02', '2025-12-31', snaps([['2025-12-31', 0], ['2026-01-01', 1.4]]));
    expect(p).toMatchObject({ asOf: '2026-01-01', plannedHours: 1.4, status: 'onTrack' });
  });

  it('нет снимков: no_data', () => {
    expect(run('2026-05-01', null, new Map())).toMatchObject({ status: 'no_data', actualHours: 0, plannedHours: 0 });
  });

  it('история началась внутри года: план считается со следующего дня после первого снимка', () => {
    const p = run('2026-01-11', '2026-01-06', snaps([['2026-01-06', 100], ['2026-01-10', 105]]));
    expect(p).toMatchObject({ from: '2026-01-07', asOf: '2026-01-10', plannedHours: 5.7, actualHours: 5, status: 'onTrack' });
  });

  it('первый синк сегодня: no_data', () => {
    expect(run('2026-01-11', '2026-01-11', snaps([['2026-01-11', 100]]))?.status).toBe('no_data');
  });

  it('год ещё не начался: not_started', () => {
    expect(run('2025-12-20', '2025-01-01', new Map())?.status).toBe('not_started');
    expect(run('2026-01-01', '2025-12-01', new Map())?.status).toBe('not_started');
  });

  it('прошедший год: весь год до 31 декабря', () => {
    const p = run('2027-03-01', '2025-12-31', snaps([['2025-12-31', 0], ['2026-12-31', 60]]));
    expect(p?.asOf).toBe('2026-12-31');
    expect(p?.plannedHours).toBe(70);
    expect(p?.status).toBe('behind');
  });

  it('no_budget: прогресса нет', () => {
    const empty = buildPlan({ year: 2026, hoursPerWeek: 0, backlog: [g(1, 10)], planned: [] });
    expect(computeProgress({ plan: empty, today: '2026-05-01', firstSnapshotDate: '2026-01-01', by: new Map(), hoursPerWeek: 0 })).toBeNull();
  });
});
