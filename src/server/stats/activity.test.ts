// Фаза 15.4 «Стрик и тепловая карта» (контракт 14.3): чистые функции + SQL-агрегат на PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { buildActivity, dailyActivity, nextDate, prevDate, type ActivityDay } from './activity';
import { getActivity } from './activity-query';
import type { Snapshot } from './hours';
import { parseActivityQuery } from './validation';

const { games, playtimeSnapshots } = schema;

/** Строки дней: date -> секунды (известный день, deltas = 1). */
const known = (m: Record<string, number>): ActivityDay[] => Object.entries(m).map(([date, seconds]) => ({ date, seconds, deltas: 1 }));
const minutesOf = (r: ReturnType<typeof buildActivity>, date: string) => r.days.find((d) => d.date === date)?.minutes;

describe('даты', () => {
  it('nextDate / prevDate через месяцы, високосный год и Новый год', () => {
    expect(nextDate('2024-02-28')).toBe('2024-02-29');
    expect(nextDate('2025-12-31')).toBe('2026-01-01');
    expect(prevDate('2026-01-01')).toBe('2025-12-31');
    expect(prevDate('2026-03-01')).toBe('2026-02-28');
  });
});

describe('dailyActivity (эталон SQL)', () => {
  it('первый снимок игры дельты не даёт, отрицательная = 0, пропуск синка: дельта в день следующего снимка', () => {
    const s: Snapshot[] = [
      { gameId: 1, date: '2026-10-01', seconds: 1000 },
      { gameId: 1, date: '2026-10-02', seconds: 1600 },
      { gameId: 1, date: '2026-10-05', seconds: 4600 },
      { gameId: 2, date: '2026-10-02', seconds: 500 }, // новая игра: первый снимок
      { gameId: 2, date: '2026-10-05', seconds: 100 }, // PSN уменьшил
    ];
    expect(dailyActivity(s)).toEqual([
      { date: '2026-10-01', seconds: 0, deltas: 0 },
      { date: '2026-10-02', seconds: 600, deltas: 1 },
      { date: '2026-10-05', seconds: 3000, deltas: 2 },
    ]);
  });
});

describe('buildActivity (чистая)', () => {
  it('нет снимков: все дни null, нули, пустые стрики; 366 дней в високосном году', () => {
    const r = buildActivity({ rows: [], year: 2024, today: '2026-10-28', firstSnapshotDate: null });
    expect(r.days).toHaveLength(366);
    expect(r.days.every((d) => d.minutes === null)).toBe(true);
    expect(r.totals).toEqual({ playedDays: 0, knownDays: 0, minutes: 0, maxMinutes: 0 });
    const empty = { days: 0, from: null, to: null, hasGaps: false };
    expect(r.streak).toEqual({ current: empty, best: empty, bestInYear: empty });
  });

  it('первый день синка неизвестен, до него null, будущее null, минуты: min 1 для любой игры', () => {
    const rows: ActivityDay[] = [{ date: '2026-10-20', seconds: 0, deltas: 0 }, ...known({ '2026-10-21': 20, '2026-10-22': 0, '2026-10-23': 5400 })];
    const r = buildActivity({ rows, year: 2026, today: '2026-10-23', firstSnapshotDate: '2026-10-20' });
    expect(r.days).toHaveLength(365);
    expect(minutesOf(r, '2026-10-19')).toBeNull();
    expect(minutesOf(r, '2026-10-20')).toBeNull();
    expect(minutesOf(r, '2026-10-21')).toBe(1);
    expect(minutesOf(r, '2026-10-22')).toBe(0);
    expect(minutesOf(r, '2026-10-23')).toBe(90);
    expect(minutesOf(r, '2026-10-24')).toBeNull();
    expect(r.totals).toEqual({ playedDays: 2, knownDays: 3, minutes: 91, maxMinutes: 90 });
  });

  it('неизвестный день не рвёт серию (hasGaps), известный 0 рвёт, сегодня не рвёт', () => {
    const rows = known({
      '2026-10-10': 60, '2026-10-11': 60, /* 12 пропуск синка */ '2026-10-13': 60, '2026-10-14': 0,
      '2026-10-15': 60, '2026-10-16': 60, '2026-10-17': 0, // сегодня 0: серия 15–16 жива
    });
    const r = buildActivity({ rows, year: 2026, today: '2026-10-17', firstSnapshotDate: '2026-10-09' });
    expect(r.streak.best).toEqual({ days: 3, from: '2026-10-10', to: '2026-10-13', hasGaps: true });
    expect(r.streak.current).toEqual({ days: 2, from: '2026-10-15', to: '2026-10-16', hasGaps: false });
  });

  it('текущий: сегодня без снимка и вчера неизвестно -> серия до позавчера; вчера 0 -> текущий 0', () => {
    const rows = known({ '2026-10-24': 60, '2026-10-25': 60 });
    const alive = buildActivity({ rows, year: 2026, today: '2026-10-27', firstSnapshotDate: '2026-10-20' });
    expect(alive.streak.current).toEqual({ days: 2, from: '2026-10-24', to: '2026-10-25', hasGaps: false });
    const broken = buildActivity({ rows: [...rows, ...known({ '2026-10-26': 0 })], year: 2026, today: '2026-10-27', firstSnapshotDate: '2026-10-20' });
    expect(broken.streak.current.days).toBe(0);
    expect(broken.streak.best.days).toBe(2);
    const today = buildActivity({ rows: [...rows, ...known({ '2026-10-26': 0, '2026-10-27': 30 })], year: 2026, today: '2026-10-27', firstSnapshotDate: '2026-10-20' });
    expect(today.streak.current).toEqual({ days: 1, from: '2026-10-27', to: '2026-10-27', hasGaps: false });
  });

  it('лучшая серия при равенстве более поздняя', () => {
    const rows = known({ '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 0, '2026-10-04': 1, '2026-10-05': 1, '2026-10-06': 0 });
    const r = buildActivity({ rows, year: 2026, today: '2026-10-10', firstSnapshotDate: '2026-09-30' });
    expect(r.streak.best).toMatchObject({ from: '2026-10-04', to: '2026-10-05' });
  });

  it('смена года по МСК: серия через 1 января режется в bestInYear, best целиком', () => {
    const rows = known({ '2025-12-29': 60, '2025-12-30': 60, '2025-12-31': 60, '2026-01-01': 60, '2026-01-02': 0, '2026-01-05': 60 });
    const r2026 = buildActivity({ rows, year: 2026, today: '2026-01-06', firstSnapshotDate: '2025-12-28' });
    expect(r2026.streak.best).toEqual({ days: 4, from: '2025-12-29', to: '2026-01-01', hasGaps: false });
    expect(r2026.streak.bestInYear).toEqual({ days: 1, from: '2026-01-05', to: '2026-01-05', hasGaps: false });
    const r2025 = buildActivity({ rows, year: 2025, today: '2026-01-06', firstSnapshotDate: '2025-12-28' });
    expect(r2025.streak.bestInYear).toEqual({ days: 3, from: '2025-12-29', to: '2025-12-31', hasGaps: false });
    expect(minutesOf(r2025, '2025-12-31')).toBe(1 * 1);
    expect(r2025.totals.playedDays).toBe(3);
    expect(r2025.streak.current).toEqual({ days: 1, from: '2026-01-05', to: '2026-01-05', hasGaps: false });
  });
});

describe('parseActivityQuery', () => {
  const p = (s: string) => parseActivityQuery(new URLSearchParams(s), 2026);
  it('по умолчанию текущий год, пустая строка = нет, мусор = ошибка', () => {
    expect(p('')).toEqual({ ok: true, value: { year: 2026 } });
    expect(p('year=')).toEqual({ ok: true, value: { year: 2026 } });
    expect(p('year=2025')).toEqual({ ok: true, value: { year: 2025 } });
    expect(p('year=1999').ok).toBe(false);
    expect(p('year=abc').ok).toBe(false);
  });
});

describe('getActivity на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(name: string, hidden = false) {
    const [g] = await t.db.insert(games).values({ titleId: name, name, category: 'ps5_native_game', lastSeenAt: new Date(), hiddenAt: hidden ? new Date() : null }).returning();
    return g.id;
  }

  it('нет снимков', async () => {
    const r = await getActivity(t.db, 2026, new Date('2026-10-27T10:00:00Z'));
    expect(r.firstSnapshotDate).toBeNull();
    expect(r.totals.knownDays).toBe(0);
  });

  it('SQL совпадает с эталоном, скрытые игры не считаются, «сегодня» по МСК на смене года', async () => {
    const a = await game('A');
    const b = await game('B');
    const h = await game('H', true);
    const snaps: Snapshot[] = [];
    let sa = 1000;
    let sb = 0;
    for (let d = '2025-12-25'; d <= '2026-01-03'; d = nextDate(d)) {
      if (d === '2025-12-28') continue; // пропуск синка
      sa += d.endsWith('30') ? 0 : 1800;
      sb += d.endsWith('27') ? -50 : 600;
      snaps.push({ gameId: a, date: d, seconds: sa }, { gameId: b, date: d, seconds: Math.max(0, sb) }, { gameId: h, date: d, seconds: 99999 + d.length * Number(d.slice(8)) });
    }
    await t.db.insert(playtimeSnapshots).values(snaps.map((s) => ({ gameId: s.gameId, snapshotDate: s.date, playDurationSeconds: s.seconds })));

    // 21:30 UTC 31 декабря = 00:30 МСК 1 января: today = 2026-01-01
    const now = new Date('2025-12-31T21:30:00Z');
    const got = await getActivity(t.db, 2025, now);
    const visible = snaps.filter((s) => s.gameId !== h);
    const expected = buildActivity({ rows: dailyActivity(visible), year: 2025, today: '2026-01-01', firstSnapshotDate: '2025-12-25' });
    expect(got).toEqual(expected);
    expect(got.today).toBe('2026-01-01');
    expect(minutesOf(got, '2025-12-25')).toBeNull(); // первый день синка
    expect(minutesOf(got, '2025-12-28')).toBeNull(); // пропуск
    expect(got.streak.best.hasGaps).toBe(true);
    const y2026 = await getActivity(t.db, 2026, now);
    expect(minutesOf(y2026, '2026-01-01')).toBe(40);
    expect(minutesOf(y2026, '2026-01-02')).toBeNull(); // будущее относительно today
  });
});
