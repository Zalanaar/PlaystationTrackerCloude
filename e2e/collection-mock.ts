// Перехват /api/* внутри e2e: БД в e2e недоступна, поэтому коллекция эмулируется в памяти по контракту §9.
// Эмуляция повторяет правила контракта (фильтры, год по МСК, счётчики, правила дат), а не логику реализации.
import type { Page, Route } from '@playwright/test';

export type Status = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved';
export type G = {
  id: number; title: string; lastPlayedAt: string | null; status: Status | null;
  completedAt: string | null; droppedAt: string | null; playSeconds: number; playCount: number;
  platform?: 'PS4' | 'PS5'; trophies?: { earned: number; defined: number; plat?: boolean } | null;
};

const ALL: Status[] = ['playing', 'completed', 'dropped', 'backlog', 'shelved'];

export function seed(): G[] {
  const g = (id: number, title: string, o: Partial<G> = {}): G => ({
    id, title, lastPlayedAt: null, status: null, completedAt: null, droppedAt: null,
    playSeconds: 0, playCount: 0, trophies: null, ...o,
  });
  return [
    g(1, 'The Witcher 3: Wild Hunt', { status: 'completed', lastPlayedAt: '2025-03-10T12:00:00.000Z', completedAt: '2025-03-10T12:00:00.000Z', playSeconds: 360000, playCount: 40, trophies: { earned: 78, defined: 78, plat: true } }),
    g(2, 'Ведьмак 3: Дикая Охота', { status: 'completed', lastPlayedAt: '2024-06-01T12:00:00.000Z', completedAt: '2024-06-01T12:00:00.000Z', playSeconds: 300000, playCount: 30 }),
    g(3, 'Horizon Forbidden West', { status: 'playing', lastPlayedAt: '2026-10-20T18:00:00.000Z', playSeconds: 101853, playCount: 19, trophies: { earned: 54, defined: 78 } }),
    g(4, 'God of War', { status: 'completed', lastPlayedAt: '2026-02-14T10:00:00.000Z', completedAt: '2026-02-14T10:00:00.000Z', playSeconds: 90000, playCount: 12 }),
    // 21:30 UTC 31 декабря = 00:30 МСК 1 января: по контракту это 2026, не 2025
    g(5, 'Hades', { status: 'dropped', lastPlayedAt: '2025-12-31T21:30:00.000Z', droppedAt: '2025-12-31T21:30:00.000Z', playSeconds: 7200, playCount: 3 }),
    g(6, 'Stray', { status: 'backlog', lastPlayedAt: '2026-09-01T10:00:00.000Z', playSeconds: 600, playCount: 1 }),
    g(7, 'Cyberpunk 2077', { status: 'shelved', lastPlayedAt: '2026-05-01T10:00:00.000Z', playSeconds: 50000, playCount: 8 }),
    g(8, 'Tetris Effect', { lastPlayedAt: '2026-10-25T10:00:00.000Z', playSeconds: 3600, playCount: 2 }),
    g(9, 'Gran Turismo 7', {}),
    g(10, 'Bloodborne', { status: 'dropped', lastPlayedAt: '2025-08-10T10:00:00.000Z', droppedAt: '2025-08-10T10:00:00.000Z', playSeconds: 30000, playCount: 5 }),
  ];
}

const mskYear = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).getUTCFullYear();
const done = (g: G) => g.completedAt ?? g.droppedAt;

function item(g: G) {
  const t = g.trophies;
  return {
    id: g.id, title: g.title, coverUrl: null, platform: g.platform ?? 'PS5', playSeconds: g.playSeconds,
    hours: Math.round(g.playSeconds / 360) / 10, playCount: g.playCount, lastPlayedAt: g.lastPlayedAt,
    status: g.status, completedAt: g.status === 'completed' ? g.completedAt : null, droppedAt: g.status === 'dropped' ? g.droppedAt : null,
    trophies: t ? {
      earned: t.earned, defined: t.defined, progress: Math.round((t.earned / t.defined) * 100),
      platinumDefined: !!t.plat, platinumEarned: !!t.plat,
      byType: { platinum: { earned: t.plat ? 1 : 0, defined: 1 }, gold: { earned: 2, defined: 4 }, silver: { earned: 5, defined: 9 }, bronze: { earned: t.earned - 8, defined: t.defined - 14 } },
    } : null,
    genres: [{ key: 'ACTION', label: 'Экшен' }],
  };
}

function counts(list: G[]) {
  const c = { all: 0, playing: 0, completed: 0, dropped: 0, backlog: 0, shelved: 0, none: 0 };
  for (const g of list) { c[g.status ?? 'none']++; c.all++; }
  return c;
}

export type Mock = {
  games: G[];
  /** URL-ы запросов GET /api/games в порядке отправки */
  listCalls: URL[];
  mutations: { method: string; url: string; body: unknown }[];
  /** задержка ответа списка по предикату на URL (мс) */
  delayList: (u: URL) => number;
  /** следующая мутация вернёт этот статус */
  failNextMutation: number | null;
  /** все мутации падают с сетевой ошибкой */
  abortMutations: boolean;
  listFails: boolean;
  syncStatus: Record<string, unknown>;
};

export async function mockApi(page: Page, games: G[] = seed()): Promise<Mock> {
  const m: Mock = {
    games, listCalls: [], mutations: [], delayList: () => 0, failNextMutation: null, abortMutations: false, listFails: false,
    syncStatus: { totals: null, running: false, run: null, lastSuccessAt: '2026-10-27T05:00:00.000Z', psnAuth: 'ok', psnAuthExpiresAt: null },
  };
  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: data }) });

  await page.route('**/api/sync/status', (r) => json(r, m.syncStatus));

  await page.route('**/api/collection/summary', (r) => {
    const sec = m.games.reduce((s, g) => s + g.playSeconds, 0);
    const byRecent = (a: G, b: G) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '');
    return json(r, {
      totals: { games: m.games.length, playSeconds: sec, hours: Math.round(sec / 360) / 10, trophiesEarned: 132, platinumEarned: 1 },
      counts: counts(m.games),
      playing: m.games.filter((g) => g.status === 'playing').sort(byRecent).map(item),
      continue: m.games.filter((g) => g.lastPlayedAt && g.status !== 'completed' && g.status !== 'dropped').sort(byRecent).slice(0, 8).map(item),
    });
  });

  await page.route(/\/api\/games(\?|$)/, async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.fallback();
    m.listCalls.push(u);
    const wait = m.delayList(u);
    if (wait) await new Promise((res) => setTimeout(res, wait));
    if (m.listFails) return json(route, { code: 'db_unavailable', message: 'x' }, 503);
    const q = (u.searchParams.get('q') ?? '').trim().toLowerCase();
    const st = u.searchParams.get('status');
    const year = u.searchParams.get('year');
    const sort = u.searchParams.get('sort') ?? 'last_played';
    const limit = Number(u.searchParams.get('limit') ?? 60);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const base = m.games.filter((g) => (!q || g.title.toLowerCase().includes(q)) && (!year || (done(g) !== null && g.status && mskYear(done(g) as string) === Number(year))));
    const wanted = st ? st.split(',') : null;
    const filtered = base.filter((g) => !wanted || wanted.includes(g.status ?? 'none'));
    const nl = (a: string | null, b: string | null, dir: 1 | -1) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : dir * a.localeCompare(b));
    const sorted = [...filtered].sort((a, b) =>
      (sort === 'title' ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
        : sort === 'hours' ? b.playSeconds - a.playSeconds
        : sort === 'completed_at' ? nl(done(a), done(b), -1)
        : sort === 'trophies_progress' ? (b.trophies ? b.trophies.earned / b.trophies.defined : -1) - (a.trophies ? a.trophies.earned / a.trophies.defined : -1)
        : nl(a.lastPlayedAt, b.lastPlayedAt, -1)) || a.id - b.id);
    const years = [...new Set(m.games.filter((g) => g.status && done(g)).map((g) => mskYear(done(g) as string)))].sort((a, b) => b - a);
    return json(route, { items: sorted.slice(offset, offset + limit).map(item), total: sorted.length, limit, offset, counts: counts(base), years });
  });

  const mutate = async (route: Route, apply: (body: Record<string, unknown>) => unknown) => {
    const req = route.request();
    const body = req.postDataJSON() as Record<string, unknown>;
    m.mutations.push({ method: req.method(), url: req.url(), body });
    if (m.abortMutations) return route.abort('failed');
    if (m.failNextMutation) {
      const s = m.failNextMutation;
      m.failNextMutation = null;
      return json(route, { code: 'db_unavailable', message: 'x' }, s);
    }
    return json(route, apply(body));
  };
  const setStatus = (g: G, s: Status | null, now = new Date().toISOString()) => {
    if (g.status === s) return;
    g.status = s;
    g.completedAt = s === 'completed' ? g.lastPlayedAt ?? now : null;
    g.droppedAt = s === 'dropped' ? g.lastPlayedAt ?? now : null;
  };

  await page.route(/\/api\/games\/\d+\/status$/, (route) => mutate(route, (b) => {
    const id = Number(route.request().url().match(/games\/(\d+)\/status/)?.[1]);
    const g = m.games.find((x) => x.id === id) as G;
    setStatus(g, b.status as Status | null);
    return { game: item(g) };
  }));
  await page.route(/\/api\/games\/\d+\/status-date$/, (route) => mutate(route, (b) => {
    const id = Number(route.request().url().match(/games\/(\d+)\/status-date/)?.[1]);
    const g = m.games.find((x) => x.id === id) as G;
    if (typeof b.completedAt === 'string') g.completedAt = b.completedAt;
    if (typeof b.droppedAt === 'string') g.droppedAt = b.droppedAt;
    return { game: item(g) };
  }));
  await page.route('**/api/games/status-bulk', (route) => mutate(route, (b) => {
    const ids = [...new Set(b.ids as number[])];
    let changed = 0;
    for (const id of ids) {
      const g = m.games.find((x) => x.id === id) as G;
      if (g.status !== b.status) changed++;
      setStatus(g, b.status as Status | null);
    }
    return { requested: ids.length, changed, games: ids.sort((a, c) => a - c).map((id) => item(m.games.find((x) => x.id === id) as G)) };
  }));
  return m;
}

export { ALL as STATUSES };
