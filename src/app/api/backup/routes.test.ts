// Маршруты копии и cron watchdog (контракт 20.2, 20.3): валидация, формат ответов, круг скачать -> восстановить, защита.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));

import { GET as watchdogGet } from '../cron/watchdog/route';
import { GET as backupGet } from './route';
import { POST as restorePost } from './restore/route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const { games, gameStatus, syncRuns } = schema;
const json = { 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = json) =>
  new Request('http://x/api/backup/restore', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const SECRET = 'c'.repeat(40);

describe('API копии разметки', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  async function seed() {
    const [g] = await t.db.insert(games).values({ userId: 1, titleId: 'A', name: 'Hades', category: 'ps5_native_game', lastSeenAt: new Date(), durationOverrideHours: 12 }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: g.id, status: 'completed', completedAt: new Date('2026-03-02T19:10:00Z') });
    return g.id;
  }

  it('GET /api/backup: файл напрямую (не конверт), заголовки скачивания, no-store', async () => {
    await seed();
    const r = await backupGet(new Request('http://x/'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="ps-tracker-backup-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await r.json();
    expect(body).toMatchObject({ app: 'ps-tracker-backup', schemaVersion: 1 });
    expect(body.ok).toBeUndefined();
    expect(body.games).toHaveLength(1);
  });

  it('GET /api/backup: БД недоступна = 503 db_unavailable в конверте', async () => {
    holder.db = null;
    const r = await backupGet(new Request('http://x/'));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });

  it('restore: Origin, Content-Type, не JSON, режим, слишком большое тело', async () => {
    const evil = { ...json, origin: 'http://evil.example', host: 'x' };
    expect((await restorePost(post({}, evil))).status).toBe(400);
    expect((await restorePost(post({}, {}))).status).toBe(400);
    const bad = await restorePost(post('{oops'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details).toEqual({ reason: 'invalid_json' });
    for (const b of [{}, { mode: 'nope', backup: {} }, [], null]) {
      const r = await restorePost(post(b as never));
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect((await r.json()).error.details.reason).toBe('invalid_format');
    }
    const big = await restorePost(post(`{"mode":"preview","pad":"${'x'.repeat(5 * 1024 * 1024 + 10)}"}`));
    expect(big.status).toBe(400);
    expect((await big.json()).error.details.reason).toBe('too_large');
  });

  it('restore: чужой файл, версия, нарушение схемы дают понятные причины', async () => {
    const detail = async (backup: unknown) => (await (await restorePost(post({ mode: 'preview', backup }))).json()).error.details;
    expect(await detail({ app: 'x' })).toEqual({ reason: 'invalid_format', path: 'app' });
    expect(await detail({ app: 'ps-tracker-backup', schemaVersion: 7, createdAt: 'x' })).toEqual({ reason: 'unsupported_version', supported: [1], got: 7 });
    const d = await detail({ app: 'ps-tracker-backup', schemaVersion: 1, createdAt: 'вчера', games: [], plannedGames: [], roadmapSettings: null });
    expect(d).toEqual({ reason: 'invalid_format', path: 'createdAt' });
  });

  it('круг через API: скачать -> испортить -> preview (ничего не пишет) -> apply -> повторный apply пустой', async () => {
    const id = await seed();
    const file = await (await backupGet(new Request('http://x/'))).json();
    await t.db.update(gameStatus).set({ status: 'dropped', completedAt: null });
    await t.db.update(games).set({ durationOverrideHours: null });

    const pre = await restorePost(post({ mode: 'preview', backup: file }));
    expect(pre.status).toBe(200);
    const preData = (await pre.json()).data;
    expect(preData).toMatchObject({ mode: 'preview', applied: false, schemaVersion: 1, fileCreatedAt: file.createdAt, backupId: null });
    expect(preData.sections.status).toEqual({ add: 0, change: 1, unchanged: 0, skipped: 0 });
    expect(preData.changes[0]).toEqual({ section: 'status', kind: 'change', titleId: 'A', name: 'Hades', from: 'dropped', to: 'completed' });
    expect((await t.db.select().from(gameStatus))[0].status).toBe('dropped');

    const app = await restorePost(post({ mode: 'apply', backup: file }));
    const appData = (await app.json()).data;
    expect(appData).toMatchObject({ mode: 'apply', applied: true });
    expect(typeof appData.backupId).toBe('number');
    expect((await t.db.select().from(gameStatus))[0]).toMatchObject({ gameId: id, status: 'completed' });
    expect((await t.db.select().from(games))[0].durationOverrideHours).toBe(12);

    const again = (await (await restorePost(post({ mode: 'apply', backup: file }))).json()).data;
    expect(again.changes).toEqual([]);
    expect(again.backupId).toBeNull();
  });

  it('restore: БД недоступна = 503', async () => {
    const file = { app: 'ps-tracker-backup', schemaVersion: 1, createdAt: '2026-10-29T06:00:00.000Z', games: [], plannedGames: [], roadmapSettings: null };
    holder.db = null;
    const r = await restorePost(post({ mode: 'preview', backup: file }));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });

  // --- cron watchdog
  const cron = (auth?: string) => new Request('http://x/api/cron/watchdog', { headers: auth ? { authorization: auth } : {} });

  it('watchdog: без Bearer или с неверным 401', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    expect((await watchdogGet(cron())).status).toBe(401);
    expect((await watchdogGet(cron('Bearer nope'))).status).toBe(401);
  });

  it('watchdog: 200, обе проверки, Telegram не настроен (ничего не отправляется)', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'daily', status: 'success', snapshotDate: '2026-01-01', startedAt: new Date('2026-01-01T20:00:00Z'), finishedAt: new Date('2026-01-01T20:05:00Z') });
    const r = await watchdogGet(cron(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    const data = (await r.json()).data;
    expect(data.sync).toMatchObject({ isOverdue: true, alert: 'telegram_disabled' });
    expect(data.backup).toEqual({ result: expect.stringMatching(/^(not_due|telegram_disabled)$/) });
  });

  it('watchdog: просрочка и Telegram настроен -> sendMessage; токен бота не в ответе', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:BOT-SECRET');
    vi.stubEnv('TELEGRAM_CHAT_ID', '42');
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'daily', status: 'success', snapshotDate: '2026-01-01', startedAt: new Date('2026-01-01T20:00:00Z'), finishedAt: new Date('2026-01-01T20:05:00Z') });
    const r = await watchdogGet(cron(`Bearer ${SECRET}`));
    const text = JSON.stringify(await r.json());
    expect(text).toContain('"alert":"sent"');
    expect(text).not.toContain('BOT-SECRET');
    expect(f.mock.calls.some((c) => String((c as unknown[])[0]).includes('/sendMessage'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('watchdog: БД недоступна — 200 с error в полях, не 5xx', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    holder.db = null;
    const r = await watchdogGet(cron(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ sync: { isOverdue: false, ageHours: null, alert: 'error' }, backup: { result: 'error' } });
  });
});
