// QA 20.5: изоляция на уровне ВСЕХ роутов, роли, роль из БД, а не из cookie.
// Не заменяет user-isolation*.test.ts (они проверяют функции и часть роутов), а закрывает роуты, которых там нет.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { createSessionTokenV2 } from '@/server/auth/session';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));

const SECRET = 'q'.repeat(48);
const API_DIR = join(process.cwd(), 'src/app/api');
const PUBLIC = new Set(['auth/login', 'auth/logout', 'auth/google', 'auth/google/callback']);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (n === 'route.ts') out.push(p);
  }
  return out;
}
const routeOf = (f: string) => relative(API_DIR, f).replace(/\/?route\.ts$/, '');
const fillParams = (route: string) => ({ params: Promise.resolve(Object.fromEntries([...route.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], '1']))) });

describe('все /api/* роуты закрыты без сессии', () => {
  beforeAll(() => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    vi.stubEnv('CRON_SECRET', 'c'.repeat(48));
  });
  afterAll(() => vi.unstubAllEnvs());

  const files = routeFiles(API_DIR);
  it('скан нашёл роуты', () => expect(files.length).toBeGreaterThan(40));

  for (const f of files) {
    const route = routeOf(f);
    if (PUBLIC.has(route)) continue;
    it(`/api/${route}: любой метод без cookie = 401 (в БД не ходит)`, async () => {
      holder.db = null; // getDb бросит, если роут дойдёт до БД до проверки сессии
      const mod = (await import(/* @vite-ignore */ f)) as Record<string, unknown>;
      let n = 0;
      for (const m of METHODS) {
        const h = mod[m];
        if (typeof h !== 'function') continue;
        n++;
        const body = m === 'GET' ? undefined : '{}';
        const req = new Request('http://x/api/' + route, { method: m, headers: { 'content-type': 'application/json' }, body });
        const res: Response = await (h as (r: Request, c: unknown) => Promise<Response>)(req, fillParams(route));
        expect(res.status, `${m} /api/${route}`).toBe(401);
      }
      expect(n, 'у роута нет обработчиков').toBeGreaterThan(0);
    });
  }

  it('битая/чужая подпись и cookie v:1 = 401', async () => {
    const { GET } = await import('@/app/api/games/route');
    for (const c of ['x.y', 'eyJ2IjoxfQ.AAAA', `pst_session_fake`]) {
      const res = await GET(new Request('http://x/api/games', { headers: { cookie: `pst_session=${c}` } }));
      expect(res.status).toBe(401);
    }
    const forged = await createSessionTokenV2('z'.repeat(48), { uid: 1, role: 'owner', amr: 'pwd' });
    expect((await GET(new Request('http://x/api/games', { headers: { cookie: `pst_session=${forged}` } }))).status).toBe(401);
  });
});

describe('роли: роль берётся из БД; member не попадает в owner-only', () => {
  let t: TestDb;
  beforeAll(async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id, psn_access_status) values ('m@example.com','member','active','psnM','ok'), ('bl@example.com','member','blocked','psnBL','ok')`));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await t.close();
  });
  beforeEach(() => {
    holder.db = t.db;
  });

  const cookie = async (uid: number, role: 'owner' | 'member') => `pst_session=${await createSessionTokenV2(SECRET, { uid, role, amr: 'google' })}`;
  const mk = async (uid: number, claimed: 'owner' | 'member', url: string, method = 'GET', body?: unknown) =>
    new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: await cookie(uid, claimed), origin: 'http://localhost', host: 'localhost' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('member (даже с подделанным в cookie role=owner, но с верной подписью) получает 403 на /api/access/*', async () => {
    const list = await import('@/app/api/access/users/route');
    const one = await import('@/app/api/access/users/[id]/route');
    const ctx = { params: Promise.resolve({ id: '1' }) };
    for (const claimed of ['member', 'owner'] as const) {
      expect((await list.GET(await mk(2, claimed, '/api/access/users'))).status, `GET ${claimed}`).toBe(403);
      expect((await list.POST(await mk(2, claimed, '/api/access/users', 'POST', { email: 'new@example.com' }))).status).toBe(403);
      expect((await one.PATCH(await mk(2, claimed, '/api/access/users/1', 'PATCH', { status: 'blocked' }), ctx)).status).toBe(403);
      expect((await one.DELETE(await mk(2, claimed, '/api/access/users/1', 'DELETE', { confirmEmail: 'x' }), ctx)).status).toBe(403);
    }
    // владелец по-прежнему активен (PATCH не прошёл)
    const rows = await t.db.select().from(schema.allowedUsers);
    expect(rows.find((r) => r.id === 1)?.status).toBe('active');
  });

  it('владелец видит список пользователей (контроль: тест не 403 для всех)', async () => {
    const list = await import('@/app/api/access/users/route');
    expect((await list.GET(await mk(1, 'owner', '/api/access/users'))).status).toBe(200);
  });

  it('blocked-пользователь с валидной подписью = 401 на данных и на /api/me/psn', async () => {
    const games = await import('@/app/api/games/route');
    const me = await import('@/app/api/me/psn/route');
    expect((await games.GET(await mk(3, 'member', '/api/games'))).status).toBe(401);
    expect((await me.GET(await mk(3, 'member', '/api/me/psn'))).status).toBe(401);
  });

  it('cron-роуты не открываются сессией владельца (нужен Bearer CRON_SECRET)', async () => {
    vi.stubEnv('CRON_SECRET', 'c'.repeat(48));
    const sync = await import('@/app/api/cron/sync/route');
    const wd = await import('@/app/api/cron/watchdog/route');
    expect((await sync.GET(await mk(1, 'owner', '/api/cron/sync'))).status).toBe(401);
    expect((await wd.GET(await mk(1, 'owner', '/api/cron/watchdog'))).status).toBe(401);
  });

  it('ручной синк member без ника = 409, не запускает синк владельца', async () => {
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('nonick@example.com','member','active')`));
    vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Target');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    const id = (await t.db.select().from(schema.allowedUsers)).find((r) => r.email === 'nonick@example.com')!.id;
    const { POST } = await import('@/app/api/sync/route');
    const res = await POST(await mk(id, 'member', '/api/sync', 'POST', {}));
    expect(res.status).toBe(409);
    expect(await t.db.select().from(schema.syncRuns)).toHaveLength(0);
  });
});

describe('роуты с чужими id: B получает 404/пусто, данные A не меняются', () => {
  let t: TestDb;
  const A = TEST_USER;
  let aGame = 0;
  let aBackup = 0;
  beforeAll(async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id, psn_access_status) values ('b@example.com','member','active','psnB','ok')`));
    const { games, gameStatus, statusBackups } = schema;
    const [g] = await t.db.insert(games).values({ userId: A, titleId: 'T', name: 'Only A', category: 'ps5_native_game', lastSeenAt: new Date(), psnGenres: ['RPG'], playDurationSeconds: 600 }).returning({ id: games.id });
    aGame = g.id;
    await t.db.insert(gameStatus).values({ userId: A, gameId: g.id, status: 'backlog' });
    const [b] = await t.db.insert(statusBackups).values({ userId: A, reason: 'reset_all', payload: [{ gameId: g.id, status: 'completed', completedAt: null, droppedAt: null, statusChangedAt: new Date().toISOString() }] }).returning({ id: statusBackups.id });
    aBackup = b.id;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await t.close();
  });

  const asB = async (url: string, method: string, body?: unknown) =>
    new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: `pst_session=${await createSessionTokenV2(SECRET, { uid: 2, role: 'member', amr: 'google' })}`, origin: 'http://localhost', host: 'localhost' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const pid = (v: number) => ({ params: Promise.resolve({ id: String(v) }) });
  const pgid = (v: number) => ({ params: Promise.resolve({ gameId: String(v) }) });

  it('мутации по id игры/копии пользователя A из-под B', async () => {
    holder.db = t.db;
    const dur = await import('@/app/api/games/[id]/duration/route');
    const sd = await import('@/app/api/games/[id]/status-date/route');
    const rv = await import('@/app/api/games/[id]/review/route');
    const me = await import('@/app/api/games/[id]/month-exclusions/route');
    const bulk = await import('@/app/api/games/status-bulk/route');
    const restore = await import('@/app/api/games/status-restore/route');
    const ex = await import('@/app/api/roadmap/exclusions/route');
    const exOne = await import('@/app/api/roadmap/exclusions/[gameId]/route');
    const dis = await import('@/app/api/recommend/dislike/route');
    const disOne = await import('@/app/api/recommend/dislike/[gameId]/route');
    const order = await import('@/app/api/roadmap/order/route');

    const r = [
      await dur.PATCH(await asB('/x', 'PATCH', { hours: 5 }), pid(aGame)),
      await sd.PATCH(await asB('/x', 'PATCH', { completedAt: '2026-01-01T00:00:00Z' }), pid(aGame)),
      await me.PUT(await asB('/x', 'PUT', { month: '2026-02', excluded: true }), pid(aGame)),
      await rv.PUT(await asB('/x', 'PUT', { rating: 7, note: 'чужая' }), pid(aGame)),
      await bulk.POST(await asB('/x', 'POST', { ids: [aGame], status: 'dropped' })),
      await restore.POST(await asB('/x', 'POST', { backupId: aBackup })),
      await ex.POST(await asB('/x', 'POST', { gameId: aGame })),
      await exOne.DELETE(await asB('/x', 'DELETE'), pgid(aGame)),
      await dis.POST(await asB('/x', 'POST', { gameId: aGame })),
      await disOne.DELETE(await asB('/x', 'DELETE'), pgid(aGame)),
      await order.PUT(await asB('/x', 'PUT', { gameIds: [aGame] })),
    ];
    const codes = r.map((x) => x.status);
    // ни одна мутация чужой игры не должна пройти (2xx)
    expect(codes.filter((c) => c < 400), `коды: ${codes.join(',')}`).toEqual([]);

    const { gameStatus, games, gameMonthExclusions, roadmapExcluded, recommendDislikes, roadmapOrder, gameReviews } = schema;
    const st = await t.db.select().from(gameStatus);
    expect(st).toHaveLength(1);
    expect(st[0].status).toBe('backlog');
    expect((await t.db.select().from(games))[0].durationOverrideHours ?? null).toBeNull();
    for (const tbl of [gameMonthExclusions, roadmapExcluded, recommendDislikes, roadmapOrder, gameReviews]) expect(await t.db.select().from(tbl)).toHaveLength(0);
  });

  it('GET-роуты B не показывают игру A', async () => {
    holder.db = t.db;
    const act = await import('@/app/api/stats/activity/route');
    const rec = await import('@/app/api/recommend/route');
    const dl = await import('@/app/api/recommend/dislikes/route');
    const bk = await import('@/app/api/games/status-backups/route');
    const feed = await import('@/app/api/trophies/feed/route');
    const calls: [string, Promise<Response>][] = [
      ['activity', act.GET(await asB('/api/stats/activity?year=2026', 'GET'))],
      ['recommend', rec.GET(await asB('/api/recommend', 'GET'))],
      ['dislikes', dl.GET(await asB('/api/recommend/dislikes', 'GET'))],
      ['backups', bk.GET(await asB('/api/games/status-backups', 'GET'))],
      ['trophy-feed', feed.GET(await asB('/api/trophies/feed?period=all', 'GET'))],
    ];
    for (const [name, pr] of calls) {
      const res = await pr;
      const text = await res.text();
      expect(text, name).not.toContain('Only A');
    }
  });
});
