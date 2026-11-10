import { describe, expect, it } from 'vitest';
import { computeBacklogPace, PACE_DAYS } from './pace';

const by = (rows: [number, string, number][]) => {
  const m = new Map<number, { date: string; seconds: number }[]>();
  for (const [id, date, h] of rows) m.set(id, [...(m.get(id) ?? []), { date, seconds: h * 3600 }]);
  return m;
};

describe('Пакет 6, п. 11: прогноз бэклога по темпу 4 недель', () => {
  it('28 дней по 1 ч в день (7 ч/нед), 70 ч бэклога: 10 недель, дата через 70 дней', () => {
    const p = computeBacklogPace({
      today: '2026-11-10', firstSnapshotDate: '2026-01-01',
      by: by([[1, '2026-10-13', 100], [1, '2026-11-10', 128]]),
      backlog: [40, 30, null],
    });
    expect(p).toMatchObject({ status: 'ok', from: '2026-10-14', to: '2026-11-10', days: PACE_DAYS, playedHours: 28, hoursPerWeek: 7, games: 3, unknownGames: 1, backlogHours: 70, weeks: 10 });
    expect(p.closeDate).toBe('2027-01-19');
  });

  it('несколько игр, сыграно до окна не считается; уменьшение playDuration = 0', () => {
    const p = computeBacklogPace({
      today: '2026-11-10', firstSnapshotDate: '2026-01-01',
      by: by([[1, '2026-09-01', 0], [1, '2026-10-01', 50], [1, '2026-11-01', 64], [2, '2026-10-20', 10], [2, '2026-11-09', 5]]),
      backlog: [14],
    });
    expect(p.playedHours).toBe(14);
    expect(p.hoursPerWeek).toBe(3.5);
    expect(p.status).toBe('ok');
    expect(p.closeDate).toBe('2026-12-08');
  });

  it('история моложе 4 недель: окно с дня после первого снимка; меньше 7 дней — no_data', () => {
    const short = computeBacklogPace({ today: '2026-11-10', firstSnapshotDate: '2026-11-06', by: by([[1, '2026-11-06', 0], [1, '2026-11-10', 4]]), backlog: [10] });
    expect(short).toMatchObject({ status: 'no_data', from: '2026-11-07', days: 4, weeks: null, closeDate: null });
    const two = computeBacklogPace({ today: '2026-11-10', firstSnapshotDate: '2026-10-26', by: by([[1, '2026-10-26', 0], [1, '2026-11-10', 14]]), backlog: [14] });
    expect(two).toMatchObject({ status: 'ok', from: '2026-10-27', days: 15, playedHours: 14 });
    expect(computeBacklogPace({ today: '2026-11-10', firstSnapshotDate: null, by: new Map(), backlog: [5] }).status).toBe('no_data');
  });

  it('пустой бэклог, без длительностей, без игры за 4 недели', () => {
    const base = { today: '2026-11-10', firstSnapshotDate: '2026-01-01', by: by([[1, '2026-10-01', 5], [1, '2026-11-10', 5]]) };
    expect(computeBacklogPace({ ...base, backlog: [] }).status).toBe('empty');
    expect(computeBacklogPace({ ...base, backlog: [null, null] })).toMatchObject({ status: 'no_hours', unknownGames: 2 });
    expect(computeBacklogPace({ ...base, backlog: [0] }).status).toBe('no_hours');
    expect(computeBacklogPace({ ...base, backlog: [10] })).toMatchObject({ status: 'no_pace', playedHours: 0, weeks: null, closeDate: null });
  });
});
