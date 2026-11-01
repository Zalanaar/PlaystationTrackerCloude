// Watchdog и копия по всем пользователям, всё владельцу (контракт 22.13); owner не найден не молчит (N-2).
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const { allowedUsers, syncRuns, notifyLog, games } = schema;
const SECRET = 'c'.repeat(40);
let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const owner = vi.hoisted(() => ({ missing: false }));
vi.mock('@/server/auth/users', async (orig) => {
  const real = await orig<typeof import('@/server/auth/users')>();
  return { ...real, getOwnerUserId: async (db: Parameters<typeof real.getOwnerUserId>[0]) => (owner.missing ? null : real.getOwnerUserId(db)) };
});

const { GET } = await import('./route');
const sent: string[] = [];
const docs: string[] = [];

const ids: Record<string, number> = { owner: 1 };
const OLD = new Date('2026-01-01T20:00:00Z');
const req = () => new Request('http://x/api/cron/watchdog', { headers: { authorization: `Bearer ${SECRET}` } });

beforeAll(async () => {
  t = await createTestDb();
  for (const [k, nick, extra] of [['a', 'User_A', {}], ['blocked', 'User_Blocked', { status: 'blocked' as const }], ['nonick', null, {}]] as const) {
    const [r] = await t.db.insert(allowedUsers).values({ email: `${k}@example.com`, role: 'member', status: 'active', psnOnlineId: nick, psnAccessStatus: nick ? 'ok' : 'unchecked', ...extra }).returning({ id: allowedUsers.id });
    ids[k] = r.id;
  }
  for (const uid of [1, ids.a, ids.blocked]) {
    await t.db.insert(syncRuns).values({ userId: uid, kind: 'daily', status: 'success', snapshotDate: '2026-01-01', startedAt: OLD, finishedAt: OLD });
  }
});
afterAll(() => t.close());
// QA-32-4: схема полная (в ней есть таблицы сводки Telegram), поэтому в воскресенье МСК cron-watchdog шлёт ещё и недельную сводку.
// Часы фиксируем на среду, чтобы тест не зависел от дня запуска; воскресный тест ставит дату сам.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T09:00:00Z'));
  owner.missing = false;
  sent.length = 0;
  docs.length = 0;
  await t.db.delete(notifyLog);
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:BOT-SECRET');
  vi.stubEnv('TELEGRAM_CHAT_ID', '42');
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Owner_Fallback');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', async (url: string, init: { body?: unknown }) => {
    if (String(url).endsWith('/sendMessage')) sent.push(String(JSON.parse(String(init.body)).text));
    else if (init.body instanceof FormData) docs.push(String(init.body.get('caption')));
    return new Response('{"ok":true}', { status: 200 });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchdog по пользователям', () => {
  it('просрочка у нескольких активных пользователей: отдельное сообщение с ником и отдельный дедуп-ключ', async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    const data = (await r.json()).data;
    expect(data.users.map((u: { userId: number }) => u.userId)).toEqual([1, ids.a]); // blocked и без ника не проверяются
    expect(data.users.map((u: { alert: string }) => u.alert)).toEqual(['sent', 'sent']);
    expect(data.sync).toMatchObject({ isOverdue: true, alert: 'sent' });
    expect(sent).toHaveLength(2);
    expect(sent.some((s) => s.includes('User_A'))).toBe(true);
    expect(sent.some((s) => s.includes('Пользователь'))).toBe(true); // у владельца подписи нет, у User_A есть
    expect(sent.filter((s) => s.includes('Пользователь'))).toHaveLength(1);
    const kinds = (await t.db.select().from(notifyLog)).map((k) => k.kind).filter((k) => k.startsWith('sync_missed')).sort();
    expect(kinds).toEqual(['sync_missed', `sync_missed:${ids.a}`]);

    // повторный запуск в тот же день: дедуп, ничего нового
    sent.length = 0;
    const again = (await (await GET(req())).json()).data;
    expect(again.users.map((u: { alert: string }) => u.alert)).toEqual(['already_sent', 'already_sent']);
    expect(sent).toHaveLength(0);
  });

  it('свежий синк пользователя: ему алерта нет, остальным есть', async () => {
    const now = new Date();
    await t.db.insert(syncRuns).values({ userId: ids.a, kind: 'daily', status: 'success', snapshotDate: '2026-10-31', startedAt: now, finishedAt: now });
    const data = (await (await GET(req())).json()).data;
    expect(data.users.map((u: { alert: string }) => u.alert)).toEqual(['sent', 'not_needed']);
    await t.db.delete(syncRuns).where(eq(syncRuns.startedAt, now));
  });

  it('еженедельная копия: по файлу на пользователя владельцу, ключи backup_weekly и backup_weekly:<id>', async () => {
    vi.setSystemTime(new Date('2026-11-01T09:00:00Z')); // воскресенье МСК
    {
      await t.db.insert(games).values({ userId: ids.a, titleId: 'BKP000001', name: 'Backup game', category: 'ps5_native_game', lastSeenAt: new Date() });
      const data = (await (await GET(req())).json()).data;
      expect(data.backup).toEqual({ result: 'sent' });
      expect(data.users.map((u: { backup: string }) => u.backup)).toEqual(['sent', 'sent']);
      expect(docs).toHaveLength(2);
      expect(docs.filter((c) => c.includes('User_A'))).toHaveLength(1);
      const kinds = (await t.db.select().from(notifyLog)).map((k) => k.kind).filter((k) => k.startsWith('backup_weekly')).sort();
      expect(kinds).toEqual(['backup_weekly', `backup_weekly:${ids.a}`]);
    }
  });

  it('нет owner: 500 config_error и сообщение в Telegram (раз в сутки), не тишина', async () => {
    owner.missing = true;
    const r = await GET(req());
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('config_error');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/владелец не найден/i);
    expect(sent[0]).not.toContain('BOT-SECRET');
    await GET(req());
    expect(sent).toHaveLength(1);
  });

  it('без Bearer: 401', async () => {
    expect((await GET(new Request('http://x/api/cron/watchdog'))).status).toBe(401);
  });
});
