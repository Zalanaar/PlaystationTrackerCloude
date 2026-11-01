// Фаза 34 (контракт 26): история игры по неделям МСК. Чистые расчёты.
import { describe, expect, it } from 'vitest';
import type { EstimateInput } from '@/server/stats/hours';
import { buildGameHistory, estimateByDay, MAX_HISTORY_WEEKS, weekStartOf } from './history';

const snap = (date: string, seconds: number, gameId = 1) => ({ gameId, date, seconds });
const trophy = (earnedAt: string | null, type = 'bronze') => ({ type, earnedAt });
const est = (o: Partial<EstimateInput> = {}): EstimateInput => ({
  gameId: 1,
  firstSnapshotDate: '2026-09-01',
  firstSeconds: 7200,
  firstPlayedAt: new Date('2026-08-10T10:00:00Z'),
  lastPlayedAt: new Date('2026-08-31T10:00:00Z'),
  ...o,
});

describe('weekStartOf', () => {
  it('понедельник и воскресенье одной недели', () => {
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26'); // пн
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26'); // вс
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02'); // следующий пн
    expect(weekStartOf('2026-06-07')).toBe('2026-06-01');
  });
  it('через границу года и 29 февраля', () => {
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekStartOf('2028-02-29')).toBe('2028-02-28');
  });
});

describe('buildGameHistory', () => {
  it('нет снимков и трофеев: null', () => {
    expect(buildGameHistory({ snaps: [], estimates: [], trophies: [] })).toBeNull();
    expect(buildGameHistory({ snaps: [], estimates: [], trophies: [trophy(null)] })).toBeNull();
  });

  it('реальные часы: дельты по неделям, первый снимок дельты не даёт, пустые недели внутри ряда с нулями', () => {
    const h = buildGameHistory({
      snaps: [snap('2026-10-05', 1000), snap('2026-10-06', 1600), snap('2026-10-07', 1600), snap('2026-10-19', 2200)],
      estimates: [],
      trophies: [],
    })!;
    expect(h.hasHours).toBe(true);
    expect(h.hasEstimate).toBe(false);
    expect(h.firstSnapshotDate).toBe('2026-10-05');
    expect(h.playedDays).toBe(2);
    expect(h.weeks.map((w) => [w.weekStart, w.seconds, w.estimatedSeconds])).toEqual([
      ['2026-10-05', 600, 0],
      ['2026-10-12', 0, 0],
      ['2026-10-19', 600, 0],
    ]);
  });

  it('граница МСК: трофей в 01:00 МСК понедельника относится к новой неделе, 23:59 МСК воскресенья к старой', () => {
    const h = buildGameHistory({
      snaps: [],
      estimates: [],
      trophies: [trophy('2026-10-25T22:00:00Z'), trophy('2026-10-25T20:59:59Z', 'platinum')],
    })!;
    expect(h.weeks).toEqual([
      { weekStart: '2026-10-19', seconds: 0, estimatedSeconds: 0, trophies: 1, platinum: true },
      { weekStart: '2026-10-26', seconds: 0, estimatedSeconds: 0, trophies: 1, platinum: false },
    ]);
  });

  it('граница МСК для часов: дата снимка (МСК) воскресенья остаётся в старой неделе', () => {
    const h = buildGameHistory({ snaps: [snap('2026-10-24', 0), snap('2026-10-25', 300), snap('2026-10-26', 900)], estimates: [], trophies: [] })!;
    expect(h.weeks.map((w) => [w.weekStart, w.seconds])).toEqual([['2026-10-19', 300], ['2026-10-26', 600]]);
  });

  it('игра без снимков: только трофеи, часов нет', () => {
    const h = buildGameHistory({ snaps: [], estimates: [], trophies: [trophy('2026-06-03T10:00:00Z'), trophy('2026-06-04T10:00:00Z')] })!;
    expect(h.hasHours).toBe(false);
    expect(h.playedDays).toBeNull();
    expect(h.firstSnapshotDate).toBeNull();
    expect(h.hasEstimate).toBe(false);
    expect(h.weeks).toEqual([{ weekStart: '2026-06-01', seconds: 0, estimatedSeconds: 0, trophies: 2, platinum: false }]);
  });

  it('снимки есть, но играть не начинали: weeks пуст, playedDays 0', () => {
    const h = buildGameHistory({ snaps: [snap('2026-10-05', 0), snap('2026-10-06', 0)], estimates: [], trophies: [] })!;
    expect(h.weeks).toEqual([]);
    expect(h.playedDays).toBe(0);
    expect(h.hasHours).toBe(true);
  });

  it('оценка до первого снимка: штриховая часть, сумма равна S0, стык с реальными дельтами', () => {
    const h = buildGameHistory({
      snaps: [snap('2026-09-01', 7200), snap('2026-09-02', 7800)],
      estimates: [est()],
      trophies: [],
    })!;
    expect(h.hasEstimate).toBe(true);
    expect(h.weeks[0].weekStart).toBe('2026-08-10');
    expect(h.weeks.reduce((a, w) => a + w.estimatedSeconds, 0)).toBe(7200);
    const last = h.weeks[h.weeks.length - 1];
    expect(last.weekStart).toBe('2026-08-31');
    // окно оценки заканчивается 2026-08-31 (L0), реальная дельта 09-02 лежит в той же неделе: смешанная неделя
    expect(last.seconds).toBe(last.estimatedSeconds + 600);
    expect(last.estimatedSeconds).toBeGreaterThan(0);
    expect(h.weeks.reduce((a, w) => a + w.seconds, 0)).toBe(7800); // = последнее время по снимкам
  });

  it('estimateByDay: доля месяца только по дням окна, остаток в последний день', () => {
    const m = estimateByDay(est({ firstSeconds: 100, firstPlayedAt: new Date('2026-08-30T10:00:00Z'), lastPlayedAt: new Date('2026-09-01T10:00:00Z') }));
    // окно 30.08..01.09: месяцы делят 100 поровну (50 + 50); август делится на 2 дня, сентябрь целиком в 1 сентября
    expect([...m.entries()]).toEqual([['2026-08-30', 25], ['2026-08-31', 25], ['2026-09-01', 50]]);
  });

  it('без first_played_at оценки нет', () => {
    const h = buildGameHistory({ snaps: [snap('2026-09-01', 7200)], estimates: [est({ firstPlayedAt: null })], trophies: [] })!;
    expect(h.hasEstimate).toBe(false);
    expect(h.weeks).toEqual([]);
  });

  it('исключённый месяц оценки (15.1) перераспределяется, сумма сохраняется', () => {
    const e = est({ firstPlayedAt: new Date('2026-07-20T10:00:00Z'), lastPlayedAt: new Date('2026-08-31T10:00:00Z'), excludedMonths: new Set(['2026-07']) });
    const h = buildGameHistory({ snaps: [snap('2026-09-01', 7200)], estimates: [e], trophies: [] })!;
    expect(h.weeks.reduce((a, w) => a + w.estimatedSeconds, 0)).toBe(7200);
    expect(h.weeks[0].weekStart).toBe('2026-07-27'); // июль исключён, но 27-31 июля делят неделю с 1-2 августа
  });

  it('дубль: две версии, оценка суммируется, ряд снимков уже слит', () => {
    const e1 = est({ firstSeconds: 3600 });
    const e2 = est({ firstSeconds: 1800, firstPlayedAt: new Date('2026-08-12T10:00:00Z') });
    const h = buildGameHistory({ snaps: [snap('2026-09-01', 5400)], estimates: [e1, e2], trophies: [] })!;
    expect(h.weeks.reduce((a, w) => a + w.estimatedSeconds, 0)).toBe(5400);
  });

  it('ряд длиннее 52 недель усекается до последних 52, truncated=true', () => {
    const h = buildGameHistory({
      snaps: [],
      estimates: [],
      trophies: [trophy('2024-01-03T10:00:00Z'), trophy('2026-10-28T10:00:00Z', 'platinum')],
    })!;
    expect(h.truncated).toBe(true);
    expect(h.weeks).toHaveLength(MAX_HISTORY_WEEKS);
    expect(h.weeks[h.weeks.length - 1]).toMatchObject({ weekStart: '2026-10-26', platinum: true });
    expect(h.weeks.reduce((a, w) => a + w.trophies, 0)).toBe(1);
  });

  it('трофеи и часы на одной шкале', () => {
    const h = buildGameHistory({ snaps: [snap('2026-10-05', 0), snap('2026-10-06', 3600)], estimates: [], trophies: [trophy('2026-10-14T10:00:00Z', 'platinum')] })!;
    expect(h.weeks.map((w) => [w.weekStart, w.seconds, w.trophies, w.platinum])).toEqual([
      ['2026-10-05', 3600, 0, false],
      ['2026-10-12', 0, 1, true],
    ]);
  });
});
