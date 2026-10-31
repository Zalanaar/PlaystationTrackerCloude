// QA 20.4 перепроверка: W-3 (предупреждение о LLM_DAILY_LIMIT при старте обхода), W-5 (текст Telegram по роли через реальный service),
// W-1 (success-запуск в обходе отмечает онбординг только своего пользователя). Движок синка подменён.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const { allowedUsers, syncRuns, notifyLog } = schema;
const SECRET = 'c'.repeat(40);
const LLM_KEY = 'llm-key-should-not-leak-123';
const afterCbs: Array<() => unknown> = [];
let t: TestDb;

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const outcome = new Map<string, 'success' | 'failed'>();
const connected: string[] = [];
vi.mock('@/server/psn/client', () => ({
  connectPsn: async (d: { onlineId: string }) => {
    connected.push(d.onlineId);
    return {};
  },
}));
vi.mock('@/server/sync/engine', async (orig) => {
  const real = await orig<typeof import('@/server/sync/engine')>();
  return {
    ...real,
    runChunk: async (deps: { connect: () => Promise<unknown>; db: typeof t.db }, run: { id: number; userId: number }) => {
      await deps.connect();
      const status = outcome.get(connected[connected.length - 1]) ?? 'success';
      await deps.db.update(syncRuns).set({ status, errorReason: status === 'failed' ? 'psn_unavailable' : null, finishedAt: new Date() }).where(and(eq(syncRuns.id, run.id), eq(syncRuns.userId, run.userId)));
      return { status, reason: status === 'failed' ? 'psn_unavailable' : null, continueNext: false };
    },
  };
});

const { GET: cronGet } = await import('./route');
const req = (q = '') => new Request(`http://x/api/cron/sync${q}`, { headers: { authorization: `Bearer ${SECRET}` } });
async function drain(): Promise<void> {
  while (afterCbs.length) await afterCbs.shift()!();
}
const telegram: Array<{ url: string; text: string }> = [];
const ids: Record<string, number> = {};
async function addUser(key: string, v: Partial<typeof allowedUsers.$inferInsert>): Promise<void> {
  const [r] = await t.db.insert(allowedUsers).values({ email: `${key}@example.com`, role: 'member', status: 'active', ...v }).returning({ id: allowedUsers.id });
  ids[key] = r.id;
}
const onboarded = async (id: number) => (await t.db.select().from(allowedUsers).where(eq(allowedUsers.id, id)))[0].onboardedAt;

beforeAll(async () => {
  t = await createTestDb({ migrations: 15 });
  ids.owner = 1;
  await addUser('a', { psnOnlineId: 'User_A', psnAccessStatus: 'ok' });
  await addUser('b', { psnOnlineId: 'User_B', psnAccessStatus: 'ok' });
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Owner_Fallback');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('SYNC_ORIGIN', 'https://app.example');
  vi.stubEnv('LLM_PROVIDER', 'groq');
  vi.stubEnv('LLM_API_KEY', LLM_KEY);
  vi.stubEnv('LLM_DAILY_LIMIT', '');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:bot');
  vi.stubEnv('TELEGRAM_CHAT_ID', '42');
  telegram.length = 0;
  vi.stubGlobal('fetch', async (url: URL | string, init: RequestInit) => {
    if (String(url).includes('api.telegram.org')) {
      telegram.push({ url: String(url), text: JSON.parse(String(init.body)).text });
      return new Response('{"ok":true}', { status: 200 });
    }
    return cronGet(new Request(url, init));
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  afterCbs.length = 0;
  connected.length = 0;
  outcome.clear();
  await t.db.delete(syncRuns);
  await t.db.delete(notifyLog);
  await t.db.update(allowedUsers).set({ onboardedAt: null });
  await t.db.update(allowedUsers).set({ psnOnlineId: null, psnAccessStatus: 'unchecked' }).where(eq(allowedUsers.id, ids.owner));
  resetTestSession();
});

const warns = () => (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

describe('W-3: LLM_DAILY_LIMIT меньше пользователи x 12', () => {
  it('старт обхода пишет предупреждение (3 польз. x 12 = 36 > 20), обход не блокируется, ключ не в логе', async () => {
    vi.stubEnv('LLM_DAILY_LIMIT', '20');
    const r = await cronGet(req());
    expect(r.status).toBe(202);
    await drain();
    expect(connected).toEqual(['Owner_Fallback', 'User_A', 'User_B']);
    const w = warns().filter((x) => x.includes('LLM_DAILY_LIMIT'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('LLM_DAILY_LIMIT=20');
    expect(w[0]).toContain('36');
    expect(warns().join('\n')).not.toContain(LLM_KEY);
  });
  it('по умолчанию (60) и при достаточном лимите предупреждения нет; звенья ?queue= не предупреждают повторно', async () => {
    await cronGet(req());
    await drain();
    expect(warns().filter((x) => x.includes('LLM_DAILY_LIMIT'))).toHaveLength(0);
    vi.stubEnv('LLM_DAILY_LIMIT', '20');
    await t.db.delete(syncRuns);
    await cronGet(req(`?queue=${ids.owner}`));
    await drain();
    expect(warns().filter((x) => x.includes('LLM_DAILY_LIMIT'))).toHaveLength(0);
  });
  it('LLM выключен (LLM_DAILY_LIMIT=0): предупреждения нет', async () => {
    vi.stubEnv('LLM_DAILY_LIMIT', '0');
    await cronGet(req());
    await drain();
    expect(warns().filter((x) => x.includes('LLM_DAILY_LIMIT'))).toHaveLength(0);
  });
});

describe('W-5: текст sync_stale по роли (реальный service -> notify)', () => {
  const old = new Date(Date.now() - 10 * 86_400_000);
  const seedOld = async (userId: number) => void (await t.db.insert(syncRuns).values({ userId, kind: 'daily', status: 'failed', snapshotDate: '2026-10-01', startedAt: old, finishedAt: old }));

  it('участнику: профиль закрыт + ник; владельцу: cron и NPSSO без ника', async () => {
    // у владельца ник записан (как после bootstrap): подпись ему всё равно не нужна
    await t.db.update(allowedUsers).set({ psnOnlineId: 'Owner_Fallback', psnAccessStatus: 'ok' }).where(eq(allowedUsers.id, ids.owner));
    await seedOld(ids.owner);
    await seedOld(ids.a);
    outcome.set('Owner_Fallback', 'failed');
    outcome.set('User_A', 'failed');
    await cronGet(req());
    await drain();
    const owner = telegram.find((m) => m.text.includes('Проверьте cron'));
    const member = telegram.find((m) => m.text.includes('Пользователь: User_A'));
    expect(owner, JSON.stringify(telegram)).toBeDefined();
    expect(owner!.text).not.toContain('Пользователь:');
    expect(owner!.text).not.toContain('профиль PSN пользователя');
    expect(member, JSON.stringify(telegram)).toBeDefined();
    expect(member!.text).toContain('профиль PSN пользователя закрыт');
    expect(member!.text).not.toContain('Проверьте cron и NPSSO.');
    const kinds = (await t.db.select().from(notifyLog)).map((r) => r.kind).sort();
    expect(kinds).toEqual(['sync_stale', `sync_stale:${ids.a}`].sort());
  });
});

describe('W-1: отметка онбординга в обходе', () => {
  it('success отмечает только своего пользователя; failed не отмечает', async () => {
    outcome.set('User_B', 'failed');
    await cronGet(req());
    await drain();
    expect(await onboarded(ids.a)).not.toBeNull();
    expect(await onboarded(ids.b)).toBeNull();
  });
});

describe('W-2: контракт ?queue (22.13) соответствует коду', () => {
  it('повторный вызов за те же сутки пересинкает всех (фильтра «за сегодня» нет); обход строго по возрастанию id и конечен', async () => {
    await cronGet(req());
    await drain();
    await cronGet(req());
    await drain();
    for (const k of ['owner', 'a', 'b']) expect((await t.db.select().from(syncRuns).where(eq(syncRuns.userId, ids[k]))).length, k).toBe(2);
    expect(connected).toEqual(['Owner_Fallback', 'User_A', 'User_B', 'Owner_Fallback', 'User_A', 'User_B']);
  });
  it('queue=<id> берёт id больше указанного; queue=0 допустим (с начала); хвост = queue_empty', async () => {
    const r = await cronGet(req(`?queue=${ids.a}`));
    await drain();
    expect(connected).toEqual(['User_B']);
    expect(r.status).toBe(202);
    const last = await cronGet(req(`?queue=${ids.b}`));
    expect((await last.json()).data).toMatchObject({ started: false, reason: 'queue_empty' });
  });
});
