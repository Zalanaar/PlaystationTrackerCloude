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
  /** Фаза 9.1 (15.2): цвет акцента */
  tint?: string | null;
  /** Фаза 11 (16): ключи жанров (по умолчанию ACTION) */
  genres?: string[];
  /** Фаза 11 (16.1): HLTB main, ручное значение, имя и статус поиска */
  hltbHours?: number | null;
  override?: number | null;
  hltbName?: string | null;
  hltbChecked?: boolean;
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

const GENRE_RU: Record<string, string> = { ACTION: 'Экшен', ADVENTURE: 'Приключения', ROLE_PLAYING_GAMES: 'Ролевые', HORROR: 'Хоррор', RACING: 'Гонки', OTHER: 'Другое' };
export type Bucket = 'lt10' | '10_30' | '30_60' | '60plus' | 'unknown';
export const hltbStatusOf = (g: G): 'found' | 'not_found' | 'unchecked' => (g.hltbName != null ? 'found' : g.hltbChecked ? 'not_found' : 'unchecked');
const hoursOf = (g: G): number | null => g.override ?? g.hltbHours ?? null;
export const bucketOf = (h: number | null): Bucket => (h === null ? 'unknown' : h < 10 ? 'lt10' : h < 30 ? '10_30' : h < 60 ? '30_60' : '60plus');

function duration(g: G) {
  const h = hoursOf(g);
  const found = g.hltbName != null;
  return {
    hours: h, source: g.override != null ? 'manual' : g.hltbHours != null ? 'hltb' : null, bucket: bucketOf(h), overrideHours: g.override ?? null,
    hltb: {
      status: found ? 'found' : g.hltbChecked ? 'not_found' : 'unchecked', id: found ? 1 : null, name: found ? g.hltbName : null,
      mainHours: found ? g.hltbHours ?? null : null, extraHours: null, checkedAt: g.hltbChecked || found ? '2026-10-20T10:00:00.000Z' : null,
    },
  };
}

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
    genres: (g.genres ?? ['ACTION']).map((key) => ({ key, label: GENRE_RU[key] ?? key })),
    duration: duration(g),
    bannerUrl: g.bannerUrl ?? null,
    tint: g.tint ?? null,
    hiddenAt: g.hiddenAt ?? null,
  };
}

/** Забытая (14.4): без статуса, играл, не запускалась больше 90 суток. */
export function isForgotten(g: G): boolean {
  return g.status === null && g.playSeconds > 0 && !!g.lastPlayedAt && Date.now() - new Date(g.lastPlayedAt).getTime() > 90 * 86_400_000;
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
  backups: { id: number; reason?: 'reset_all' | 'before_restore'; rows: Pick<G, 'id' | 'status' | 'completedAt' | 'droppedAt'>[] }[];
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
  /** `platinumForecast` деталей по id игры (14.2, 15.3); нет записи = null */
  forecasts: Record<number, Record<string, unknown> | null>;
  /** Фаза 15 (14.3): GET /api/stats/activity */
  activityCalls: URL[];
  activityFails: number | null;
  /** задержка ответа активности, мс */
  activityDelay: number;
  /** активность: «снимков нет» (firstSnapshotDate = null) */
  activityEmpty: boolean;
  /** дата первого снимка (YYYY-MM-DD) вместо 15 января текущего года */
  activityFirst: string | null;
  /** Фаза 15 (14.2): `summary.nearPlatinum` по id игры; пусто = блока нет */
  nearPlatinum: { id: number; forecast: Record<string, unknown> }[];
  /** ответы без новых полей Фазы 15 (старый контракт): проверка устойчивости */
  legacySummary: boolean;
  /** Фаза 11 (16.7): тела POST /api/hltb/run в порядке отправки */
  hltbCalls: Record<string, unknown>[];
  /** очередь ответов POST /api/hltb/run: объект = 200 data, { status, code } = ошибка; пустая очередь = complete без работы */
  hltbRuns: ({ data: Record<string, unknown> } | { status: number; code: string })[];
  /** задержка ответа POST /api/hltb/run, мс */
  hltbDelay: number;
  /** что делать с игрой при ответе с `apply`: ключи games, у которых после вызова появляется совпадение */
  hltbApply: (games: G[], call: number) => void;
};

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Ответ GET /api/stats/activity по контракту 14.3: первый снимок 15 января текущего года МСК, дальше детерминированный узор. */
export function activityFor(year: number, empty = false, firstDay?: string) {
  const today = isoDay(Date.now() + 3 * 3600_000);
  const thisYear = Number(today.slice(0, 4));
  const first = empty ? null : (firstDay ?? `${thisYear}-01-15`);
  const pattern = [0, 20, 45, 120, 200, 0, 95];
  const days: { date: string; minutes: number | null }[] = [];
  let i = 0;
  for (let t = Date.UTC(year, 0, 1); new Date(t).getUTCFullYear() === year; t += DAY, i++) {
    const date = isoDay(t);
    days.push({ date, minutes: first && date > first && date <= today ? pattern[i % pattern.length] : null });
  }
  const known = days.filter((d) => d.minutes !== null);
  const none = { days: 0, from: null, to: null, hasGaps: false };
  const best = first ? { days: 4, from: isoDay(Date.parse(first) + 10 * DAY), to: isoDay(Date.parse(first) + 13 * DAY), hasGaps: true } : none;
  return {
    year, today, firstSnapshotDate: first, days,
    totals: {
      playedDays: known.filter((d) => (d.minutes as number) > 0).length, knownDays: known.length,
      minutes: known.reduce((a, d) => a + (d.minutes as number), 0), maxMinutes: Math.max(0, ...known.map((d) => d.minutes as number)),
    },
    streak: {
      current: first ? { days: 2, from: isoDay(Date.parse(today) - 2 * DAY), to: isoDay(Date.parse(today) - DAY), hasGaps: false } : none,
      best,
      bestInYear: year === thisYear ? best : none,
    },
  };
}

export async function mockApi(page: Page, games: G[] = seed()): Promise<Mock> {
  const m: Mock = {
    games, listCalls: [], mutations: [], delayList: () => 0, failNextMutation: null, abortMutations: false, listFails: false, backups: [],
    profile: null, trophies: {}, failDetails: null, detailsDelay: 0, detailCalls: [], forecasts: {},
    activityCalls: [], activityFails: null, activityDelay: 0, activityEmpty: false, activityFirst: null, nearPlatinum: [], legacySummary: false,
    hltbCalls: [], hltbRuns: [], hltbDelay: 0, hltbApply: () => {},
    syncStatus: { totals: null, running: false, run: null, lastSuccessAt: '2026-10-27T05:00:00.000Z', psnAuth: 'ok', psnAuthExpiresAt: null },
  };
  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: data }) });

  await page.route('**/api/sync/status', (r) => json(r, m.syncStatus));

  await page.route(/\/api\/stats\/activity(\?|$)/, async (r) => {
    const u = new URL(r.request().url());
    m.activityCalls.push(u);
    if (m.activityDelay) await new Promise((res) => setTimeout(res, m.activityDelay));
    if (m.activityFails) return json(r, { code: 'db_unavailable', message: 'x' }, m.activityFails);
    const year = Number(u.searchParams.get('year') ?? new Date(Date.now() + 3 * 3600_000).getUTCFullYear());
    return json(r, activityFor(year, m.activityEmpty, m.activityFirst ?? undefined));
  });

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
      ...(m.legacySummary ? {} : { nearPlatinum: m.nearPlatinum.flatMap((n) => { const g = m.games.find((x) => x.id === n.id); return g ? [{ game: item(g), forecast: n.forecast }] : []; }) }),
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
    const genresQ = u.searchParams.get('genres')?.split(',').map((x) => x.toUpperCase()) ?? null;
    const durQ = u.searchParams.get('duration')?.split(',') ?? null;
    const hltbQ = u.searchParams.get('hltb')?.split(',') ?? null;
    // контракт 16.4: `none` = у игры нет жанров (genres: []), такая игра по 1.9 ещё и OTHER
    const keysOf = (g: G) => { const k = g.genres ?? ['ACTION']; return k.length ? k : ['OTHER']; };
    const inScope = base.filter((g) => (!genresQ || keysOf(g).some((k) => genresQ.includes(k)) || (genresQ.includes('NONE') && (g.genres ?? ['ACTION']).length === 0)));
    const genreCounts: Record<string, number> = {};
    for (const g of base.filter((x) => (!durQ || durQ.includes(bucketOf(hoursOf(x)))) && (!wanted || wanted.includes(x.status ?? 'none')) && (u.searchParams.get('forgotten') !== 'only' || isForgotten(x)))) {
      for (const k of keysOf(g)) genreCounts[k] = (genreCounts[k] ?? 0) + 1;
      if ((g.genres ?? ['ACTION']).length === 0) genreCounts.none = (genreCounts.none ?? 0) + 1;
    }
    const hltbCounts = { found: 0, not_found: 0, unchecked: 0 };
    for (const g of inScope.filter((x) => (!durQ || durQ.includes(bucketOf(hoursOf(x)))) && (!wanted || wanted.includes(x.status ?? 'none')))) hltbCounts[hltbStatusOf(g)]++;
    const filtered = inScope.filter((g) => (!hltbQ || hltbQ.includes(hltbStatusOf(g))) && (!durQ || durQ.includes(bucketOf(hoursOf(g)))) && (!wanted || wanted.includes(g.status ?? 'none')) && (u.searchParams.get('forgotten') !== 'only' || isForgotten(g)));
    const durCounts = { lt10: 0, '10_30': 0, '30_60': 0, '60plus': 0, unknown: 0 };
    for (const g of inScope.filter((x) => !wanted || wanted.includes(x.status ?? 'none'))) durCounts[bucketOf(hoursOf(g))]++;
    const nl = (a: string | null, b: string | null, dir: 1 | -1) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : dir * a.localeCompare(b));
    const sorted = [...filtered].sort((a, b) =>
      (sort === 'title' ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
        : sort === 'hours' ? b.playSeconds - a.playSeconds
        : sort === 'completed_at' ? nl(done(a), done(b), -1)
        : sort === 'duration' ? (() => {
          const x = hoursOf(a); const y = hoursOf(b);
          if (x === y) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return u.searchParams.get('order') === 'desc' ? y - x : x - y;
        })()
        : sort === 'trophies_progress' ? (b.trophies ? b.trophies.earned / b.trophies.defined : -1) - (a.trophies ? a.trophies.earned / a.trophies.defined : -1)
        : nl(a.lastPlayedAt, b.lastPlayedAt, u.searchParams.get('order') === 'asc' ? 1 : -1)) || a.id - b.id);
    const years = [...new Set(scope.filter((g) => g.status && done(g)).map((g) => mskYear(done(g) as string)))].sort((a, b) => b - a);
    return json(route, {
      items: sorted.slice(offset, offset + limit).map(item), total: sorted.length, limit, offset, counts: counts(inScope.filter((g) => !durQ || durQ.includes(bucketOf(hoursOf(g))))), years, durationCounts: durCounts, genreCounts, hltbCounts,
      ...(m.legacySummary ? {} : { forgottenCount: visible().filter(isForgotten).length }),
    });
  });

  await page.route('**/api/hltb/run', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    m.hltbCalls.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
    if (m.hltbDelay) await new Promise((res) => setTimeout(res, m.hltbDelay));
    const next = m.hltbRuns.shift();
    if (next && 'status' in next) return json(route, { code: next.code, message: 'x' }, next.status);
    m.hltbApply(m.games, m.hltbCalls.length);
    return json(route, next?.data ?? { processed: 0, found: 0, notFound: 0, failed: 0, remaining: 0, done: true, stopReason: 'complete', warnings: [] });
  });

  await page.route('**/api/hltb/run', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    m.hltbCalls.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
    if (m.hltbDelay) await new Promise((res) => setTimeout(res, m.hltbDelay));
    const next = m.hltbRuns.shift();
    if (next && 'status' in next) return json(route, { code: next.code, message: 'x' }, next.status);
    m.hltbApply(m.games, m.hltbCalls.length);
    return json(route, next?.data ?? { processed: 0, found: 0, notFound: 0, failed: 0, remaining: 0, done: true, stopReason: 'complete', warnings: [] });
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
      platinumForecast: m.forecasts[id] ?? null,
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
  await page.route(/\/api\/games\/\d+\/duration$/, (route) => mutate(route, (b) => {
    const id = Number(route.request().url().match(/games\/(\d+)\/duration/)?.[1]);
    const g = m.games.find((x) => x.id === id);
    if (!g) return NOT_FOUND;
    g.override = b.hours === null ? null : Math.round((b.hours as number) * 10) / 10;
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
    m.backups.push({ id, rows, reason: 'reset_all' });
    for (const g of visible()) { g.status = null; g.completedAt = null; g.droppedAt = null; }
    return { backupId: id, reset: rows.length };
  }));
  await page.route('**/api/games/status-backups', (route) => {
    const last = [...m.backups].reverse().find((x) => x.reason !== 'before_restore');
    const body = { ok: true, data: { latest: last ? { id: last.id, createdAt: '2026-10-27T10:00:00.000Z', reason: 'reset_all', count: last.rows.length } : null } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/games/status-restore', (route) => mutate(route, (b) => {
    const src = m.backups.find((x) => x.id === b.backupId);
    if (!src) return NOT_FOUND;
    const id = m.backups.length + 1;
    m.backups.push({ id, rows: snapshot(), reason: 'before_restore' });
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
