// Моки /api/stats по контракту §10 (общие для stats.spec и stats-sections.spec). БД в e2e недоступна.
import type { BrowserContext, Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

export const TODAY = { year: Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4)), month: Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(5, 7)) };
export const FIRST = `${TODAY.year}-01-15`;
export const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

const game = (id: number, title: string, status: 'completed' | 'dropped') => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: status === 'completed' ? '2026-03-10T10:00:00.000Z' : null, droppedAt: status === 'dropped' ? '2026-03-12T10:00:00.000Z' : null,
  trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});

export type Opts = { empty?: boolean; hoursNull?: boolean; estimate?: boolean };
/** Ответ по контракту §10.1 для разобранных параметров. */
export function respond(u: URL, o: Opts = {}) {
  const type = u.searchParams.get('period') === 'month' ? 'month' : 'year';
  const year = Number(u.searchParams.get('year') ?? TODAY.year);
  const month = type === 'month' ? Number(u.searchParams.get('month')) : null;
  const last = month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
  const p = (n: number) => String(n).padStart(2, '0');
  const has = !o.empty && year >= TODAY.year - 1;
  const byMonth = Array.from({ length: 12 }, (_, i) => (year < TODAY.year ? null : i + 1 > TODAY.month ? null : i === 0 ? (o.estimate ? 5 : null) : 10 + i));
  return {
    period: {
      type, year, month, from: `${year}-${p(month ?? 1)}-01`, to: `${year}-${p(month ?? 12)}-${p(last)}`,
      fromUtc: new Date(Date.UTC(year, (month ?? 1) - 1, 1) - 3 * 3600_000).toISOString(), toUtc: new Date(Date.UTC(year, (month ?? 12) - 1, last + 1) - 3 * 3600_000).toISOString(),
    },
    years: [TODAY.year, TODAY.year - 1],
    header: { completed: has ? 1 : 0, dropped: has ? 1 : 0, hours: o.hoursNull || year < TODAY.year ? null : has ? 123.4 : 0, platinum: has ? 2 : 0 },
    hours: {
      byMonth: has ? byMonth : byMonth.map(() => null),
      // оценка: январь целиком оценочный, февраль частично (контракт §10.1: estimatedByMonth <= byMonth)
      estimatedByMonth: has && o.estimate && year === TODAY.year ? byMonth.map((v, i) => (i === 0 ? 5 : i === 1 && v ? 4 : 0)) : Array(12).fill(0),
      estimatedHours: has && o.estimate ? 9 : 0, hasEstimate: !!has && !!o.estimate,
      firstSnapshotDate: FIRST, periodPartial: year <= TODAY.year && (month ?? 1) <= 1 || year < TODAY.year },
    genres: has
      ? { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5, gameIds: [1, 2] }, { key: 'OTHER', label: 'Другое', value: 3, gameIds: [2] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null }, 2: { id: 2, title: 'Игра Два', coverUrl: null } } }
      : { hasData: false, items: [], games: {} },
    top: has
      ? {
        byHours: [{ game: game(1, 'Игра Один', 'completed'), hours: 12.5, estimated: false }, { game: game(2, 'Игра Два', 'dropped'), hours: 2, estimated: true }],
        byTrophies: [{ game: game(1, 'Игра Один', 'completed'), points: 840, counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 } }],
      }
      : { byHours: [], byTrophies: [] },
    trophies: {
      counts: has ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z,
      byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...(has && i === 2 ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z) })),
    },
    finished: has
      ? { groups: [{ month: `${year}-03`, year, monthNumber: 3, items: [{ kind: 'completed', at: '2026-03-10T10:00:00.000Z', game: game(1, 'Игра Один', 'completed') }, { kind: 'dropped', at: '2026-03-12T10:00:00.000Z', game: game(2, 'Игра Два', 'dropped') }] }] }
      : { groups: [] },
    // «Игры месяца» (Фаза 8): мартовские завершения + «Игра Один» ещё и в феврале (играли, но не завершили)
    played: has
      ? { games: { 1: game(1, 'Игра Один', 'completed'), 2: game(2, 'Игра Два', 'dropped') }, groups: [
        { month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 1, items: [
          { gameId: 2, hours: 2, estimated: false, finished: 'dropped', finishedAt: '2026-03-12T10:00:00.000Z' },
          { gameId: 1, hours: 12.5, estimated: false, finished: 'completed', finishedAt: '2026-03-10T10:00:00.000Z' },
        ] },
        { month: `${year}-02`, year, monthNumber: 2, completed: 0, dropped: 0, items: [
          { gameId: 1, hours: 7.5, estimated: true, finished: null, finishedAt: null },
        ] },
      ] }
      : { games: {}, groups: [] },
  };
}

export type Ctl = { calls: URL[]; opts: Opts; fail: number | null };
export async function open(page: Page, context: BrowserContext, baseURL: string, url = '/stats'): Promise<Ctl> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const ctl: Ctl = { calls: [], opts: {}, fail: null };
  await page.route(/\/api\/stats\?/, (r) => {
    const u = new URL(r.request().url());
    ctl.calls.push(u);
    if (ctl.fail) return r.fulfill({ status: ctl.fail, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(u, ctl.opts) }) });
  });
  await page.goto(url);
  return ctl;
}
