// Перехват /api/* внутри e2e: БД в e2e недоступна, поэтому коллекция эмулируется в памяти по контракту §9.
// Эмуляция повторяет правила контракта (фильтры, год по МСК, счётчики, правила дат), а не логику реализации.
import type { Page, Route } from '@playwright/test';

export type Status = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved' | 'service';
export type G = {
  id: number; title: string; lastPlayedAt: string | null; status: Status | null;
  completedAt: string | null; droppedAt: string | null; playSeconds: number; playCount: number;
  platform?: 'PS4' | 'PS5'; coverUrl?: string | null; trophies?: { earned: number; defined: number; plat?: boolean } | null;
  /** Фаза 8 (9.7): скрыта из коллекции */
  hiddenAt?: string | null;
  /** Фаза 9 (12.2): горизонтальный арт */
  bannerUrl?: string | null;
};

/** Трофей в ответе GET /api/games/{id} (12.5) */
export type MockTrophy = {
  setId: number; trophyId: number; type: 'platinum' | 'gold' | 'silver' | 'bronze'; name: string | null; detail: string | null; iconUrl: string | null;
  hidden: boolean; earned: boolean; earnedAt: string | null; rarity: number | null; earnedRate: number | null;
};
/** PsnProfile (12.3) */
export type MockProfile = {
  onlineId: string; avatarUrl: string | null; level: number | null; levelProgress: number | null; tier: number | null;
  trophies: { platinum: number; gold: number; silver: number; bronze: number; total: number } | null;
};

/** Типовой набор трофеев: платина получена, редкие, скрытый не полученный, скрытый полученный, без редкости. */
export function trophyList(): MockTrophy[] {
  const t = (trophyId: number, o: Partial<MockTrophy> = {}): MockTrophy => ({
    setId: 1, trophyId, type: 'bronze', name: `Трофей ${trophyId}`, detail: `Описание ${trophyId}`, iconUrl: null, hidden: false, earned: false, earnedAt: null,
    rarity: 3, earnedRate: 50, ...o,
  });
  return [
    t(0, { type: 'platinum', name: 'Легенда', detail: 'Получите все трофеи', earned: true, earnedAt: '2026-10-05T18:42:11.000Z', rarity: 0, earnedRate: 2.4 }),
    t(1, { type: 'gold', earned: true, earnedAt: '2026-09-01T10:00:00.000Z', rarity: 2, earnedRate: 12.5 }),
    t(2, { type: 'silver', earned: true, earnedAt: null, rarity: 1, earnedRate: 0.05 }),
    t(3, { type: 'bronze', hidden: true, name: null, detail: null, rarity: 1, earnedRate: 4.1 }),
    t(4, { type: 'bronze', hidden: true, earned: true, earnedAt: '2026-08-01T10:00:00.000Z', rarity: null, earnedRate: null }),
    t(5, { type: 'bronze' }),
  ];
}

const NOT_FOUND = Symbol('not_found');
const ALL: Status[] = ['playing', 'completed', 'dropped', 'backlog', 'shelved', 'service'];

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

/** N игр-сервисов (id от 100) с убывающим последним запуском: для проверки блока «Игры-сервисы». */
export function serviceGames(n: number): G[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 100 + i, title: `Сервис ${i + 1}`, lastPlayedAt: new Date(Date.UTC(2026, 9, 25 - i, 10)).toISOString(), status: 'service' as const,
    completedAt: null, droppedAt: null, playSeconds: 7200 + i * 600, playCount: 4, trophies: null,
  }));
}

const mskYear = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).getUTCFullYear();
const done = (g: G) => g.completedAt ?? g.droppedAt;

function item(g: G) {
  const t = g.trophies;
  return {
    id: g.id, title: g.title, coverUrl: g.coverUrl ?? null, platform: g.platform ?? 'PS5', playSeconds: g.playSeconds,
    hours: Math.round(g.playSeconds / 360) / 10, playCount: g.playCount, lastPlayedAt: g.lastPlayedAt,
    status: g.status, completedAt: g.status === 'completed' ? g.completedAt : null, droppedAt: g.status === 'dropped' ? g.droppedAt : null,
    trophies: t ? {
      earned: t.earned, defined: t.defined, progress: Math.round((t.earned / t.defined) * 100),
      platinumDefined: !!t.plat, platinumEarned: !!t.plat,
      byType: { platinum: { earned: t.plat ? 1 : 0, defined: 1 }, gold: { earned: 2, defined: 4 }, silver: { earned: 5, defined: 9 }, bronze: { earned: t.earned - 8, defined: t.defined - 14 } },
    } : null,
    genres: [{ key: 'ACTION', label: 'Экшен' }],
    bannerUrl: g.bannerUrl ?? null,
    hiddenAt: g.hiddenAt ?? null,
  };
}

function counts(list: G[]) {
  const c = { all: 0, playing: 0, completed: 0, dropped: 0, backlog: 0, shelved: 0, service: 0, none: 0 };
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
  /** status_backups (9.8, 9.9): снимки статусов видимых игр */
  backups: { id: number; rows: Pick<G, 'id' | 'status' | 'completedAt' | 'droppedAt'>[] }[];
  /** `summary.profile` (12.3); null = профиля нет */
  profile: MockProfile | null;
  /** Трофеи GET /api/games/{id} по id игры; нет записи = trophyList() */
  trophies: Record<number, MockTrophy[]>;
  /** GET /api/games/{id} отвечает этим статусом, пока не сброшен в null */
  failDetails: number | null;
  /** задержка ответа деталей, мс */
  detailsDelay: number;
  /** id запросов деталей в порядке отправки */
  detailCalls: number[];
};

export async function mockApi(page: Page, games: G[] = seed()): Promise<Mock> {
  const m: Mock = {
    games, listCalls: [], mutations: [], delayList: () => 0, failNextMutation: null, abortMutations: false, listFails: false, backups: [],
    profile: null, trophies: {}, failDetails: null, detailsDelay: 0, detailCalls: [],
    syncStatus: { totals: null, running: false, run: null, lastSuccessAt: '2026-10-27T05:00:00.000Z', psnAuth: 'ok', psnAuthExpiresAt: null },
  };
  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: data }) });

  await page.route('**/api/sync/status', (r) => json(r, m.syncStatus));

  const visible = () => m.games.filter((g) => !g.hiddenAt);
  await page.route('**/api/collection/summary', (r) => {
    const games = visible();
    const sec = games.reduce((s, g) => s + g.playSeconds, 0);
    const byRecent = (a: G, b: G) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '');
    return json(r, {
      totals: { games: games.length, playSeconds: sec, hours: Math.round(sec / 360) / 10, trophiesEarned: 132, platinumEarned: games.filter((g) => g.trophies?.plat).length },
      counts: counts(games),
      playing: games.filter((g) => g.status === 'playing').sort(byRecent).map(item),
      services: games.filter((g) => g.status === 'service').sort(byRecent).slice(0, 50).map(item),
      continue: games.filter((g) => g.lastPlayedAt && g.status !== 'completed' && g.status !== 'dropped').sort(byRecent).slice(0, 8).map(item),
      profile: m.profile,
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
    const scope = u.searchParams.get('hidden') === 'only' ? m.games.filter((g) => g.hiddenAt) : visible();
    const base = scope.filter((g) => (!q || g.title.toLowerCase().includes(q)) && (!year || (done(g) !== null && g.status && mskYear(done(g) as string) === Number(year))));
    const wanted = st ? st.split(',') : null;
    const filtered = base.filter((g) => !wanted || wanted.includes(g.status ?? 'none'));
    const nl = (a: string | null, b: string | null, dir: 1 | -1) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : dir * a.localeCompare(b));
    const sorted = [...filtered].sort((a, b) =>
      (sort === 'title' ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
        : sort === 'hours' ? b.playSeconds - a.playSeconds
        : sort === 'completed_at' ? nl(done(a), done(b), -1)
        : sort === 'trophies_progress' ? (b.trophies ? b.trophies.earned / b.trophies.defined : -1) - (a.trophies ? a.trophies.earned / a.trophies.defined : -1)
        : nl(a.lastPlayedAt, b.lastPlayedAt, u.searchParams.get('order') === 'asc' ? 1 : -1)) || a.id - b.id);
    const years = [...new Set(scope.filter((g) => g.status && done(g)).map((g) => mskYear(done(g) as string)))].sort((a, b) => b - a);
    return json(route, { items: sorted.slice(offset, offset + limit).map(item), total: sorted.length, limit, offset, counts: counts(base), years });
  });

  await page.route(/\/api\/games\/\d+(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = Number(route.request().url().match(/games\/(\d+)/)?.[1]);
    m.detailCalls.push(id);
    if (m.detailsDelay) await new Promise((res) => setTimeout(res, m.detailsDelay));
    if (m.failDetails) {
      const st = m.failDetails;
      return json(route, { code: st === 404 ? 'not_found' : 'db_unavailable', message: 'x' }, st);
    }
    const g = m.games.find((x) => x.id === id);
    if (!g) return json(route, { code: 'not_found', message: 'x' }, 404);
    return json(route, {
      game: item(g), firstPlayedAt: g.lastPlayedAt ? '2024-03-01T10:00:00.000Z' : null,
      statusChangedAt: g.status ? '2026-10-06T08:00:00.000Z' : null,
      trophyList: g.trophies ? (m.trophies[id] ?? trophyList()) : [],
    });
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
    const out = apply(body);
    if (out === NOT_FOUND) return json(route, { code: 'not_found', message: 'x' }, 404);
    return json(route, out);
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
  await page.route(/\/api\/games\/\d+\/hidden$/, (route) => mutate(route, (b) => {
    const id = Number(route.request().url().match(/games\/(\d+)\/hidden/)?.[1]);
    const g = m.games.find((x) => x.id === id) as G;
    if (b.hidden === true && !g.hiddenAt) g.hiddenAt = new Date().toISOString();
    if (b.hidden === false) g.hiddenAt = null;
    return { game: item(g) };
  }));
  const snapshot = () => visible().filter((g) => g.status).map((g) => ({ id: g.id, status: g.status, completedAt: g.completedAt, droppedAt: g.droppedAt }));
  await page.route('**/api/games/status-reset-all', (route) => mutate(route, () => {
    const rows = snapshot();
    if (!rows.length) return { backupId: null, reset: 0 };
    const id = m.backups.length + 1;
    m.backups.push({ id, rows });
    for (const g of visible()) { g.status = null; g.completedAt = null; g.droppedAt = null; }
    return { backupId: id, reset: rows.length };
  }));
  await page.route('**/api/games/status-restore', (route) => mutate(route, (b) => {
    const src = m.backups.find((x) => x.id === b.backupId);
    if (!src) return NOT_FOUND;
    const id = m.backups.length + 1;
    m.backups.push({ id, rows: snapshot() });
    for (const g of visible()) { g.status = null; g.completedAt = null; g.droppedAt = null; }
    let restored = 0;
    let skipped = 0;
    for (const r of src.rows) {
      const g = visible().find((x) => x.id === r.id);
      if (!g) { skipped++; continue; }
      Object.assign(g, { status: r.status, completedAt: r.completedAt, droppedAt: r.droppedAt });
      restored++;
    }
    return { restored, skipped, backupId: id };
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
