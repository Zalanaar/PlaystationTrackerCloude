// Ответ GET /api/stats?period=all для спеков панелей «Всё время» (контракт §26), как в stats-all-time.spec.
const NOW = new Date(Date.now() + 3 * 3600_000);
const CUR = NOW.getUTCFullYear();
const FIRST_Y = CUR - 5;
const zeroC = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

const game = (id: number, title: string, status: 'completed' | 'dropped' | null = null) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 360000, hours: 100, playCount: 19, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: null, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});

const HOURS = Array.from({ length: 24 }, (_, i) => (i === 21 ? 48 : i === 22 ? 30 : i === 23 ? 12 : i < 4 ? 4 : 1));
const pattern = (hasData = true) => ({
  byHour: HOURS, byWeekday: [20, 15, 10, 8, 30, 62, 33], total: hasData ? 178 : 5, peakHour: 21, peakWeekday: 5, label: 'по времени трофеев', hasData,
});

export type Opts = { unattributed?: number; noEstimate?: boolean; pattern?: boolean; empty?: boolean };

export function statsAll(o: Opts) {
  const years = Array.from({ length: 6 }, (_, i) => FIRST_Y + i);
  const byYear = years.map((y, i) => ({
    year: y, hours: i === 1 ? 0 : 100 + i * 50, estimatedHours: o.noEstimate ? 0 : i < 3 ? (i === 1 ? 0 : 100 + i * 50) : 0,
    measuredHours: o.noEstimate ? (i === 1 ? 0 : 100 + i * 50) : i < 3 ? 0 : 100 + i * 50,
  }));
  const sum = byYear.reduce((a, b) => a + b.hours, 0);
  const un = o.unattributed ?? 0;
  const trophyYears = years.map((y, i) => ({ year: y, platinum: i % 2, gold: i, silver: 2 * i, bronze: 3 * i, total: (i % 2) + 6 * i }));
  const tc = trophyYears.reduce((a, y) => ({ platinum: a.platinum + y.platinum, gold: a.gold + y.gold, silver: a.silver + y.silver, bronze: a.bronze + y.bronze, total: a.total + y.total }), { ...zeroC });
  return {
    period: { type: 'all', year: CUR, month: null, from: `${FIRST_Y}-03-02`, to: `${CUR}-10-27`, fromUtc: null, toUtc: null },
    years: [...years].reverse(),
    header: o.empty ? { completed: 0, dropped: 0, hours: null, platinum: 0 } : { completed: 10, dropped: 3, hours: Math.round((sum + un) * 10) / 10, platinum: tc.platinum },
    hours: {
      byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0),
      estimatedHours: byYear.reduce((a, b) => a + b.estimatedHours, 0), hasEstimate: !o.noEstimate,
      firstSnapshotDate: `${FIRST_Y + 3}-03-04`, periodPartial: true, byYear, unattributed: un,
    },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 12.5, gameIds: [1] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null } } },
    top: { byHours: [{ game: game(1, 'Игра Один', 'completed'), hours: 310.2, estimated: false }], byTrophies: [{ game: game(1, 'Игра Один'), points: 1200, counts: { platinum: 1, gold: 3, silver: 9, bronze: 20, total: 33 } }] },
    rareTrophies: { period: [], allTime: [] },
    trophies: { counts: tc, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...zeroC })), byYear: trophyYears },
    finished: { groups: [], byYear: years.map((y, i) => ({ year: y, completed: i === 4 ? 0 : i + 1, dropped: i === 4 ? 0 : i % 3 })) },
    played: { games: {}, groups: [] },
    playPattern: o.pattern === false ? pattern(false) : pattern(true),
  };
}
