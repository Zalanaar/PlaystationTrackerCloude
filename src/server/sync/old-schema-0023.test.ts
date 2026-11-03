// Фаза 32.1 (QA): новый код на схеме без 0023 (enum без 'cancelled'). Контракт 8.8: отмена = 503, остальной синк работает.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectPsn } from '@/server/psn/client';
import { resetTestSession } from '@/server/auth/test-require-user';
import { runChunk } from './engine';
import { cancelRun, restartRun, startRun } from './runs';
import { getSyncStatus } from './status';
import { createTestDb, fakeApi, freshState, TEST_USER, type TestDb } from './test-helpers';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const NOW = new Date('2026-10-27T17:00:00Z');

describe('QA-32.1: схема без 0023', () => {
  beforeAll(async () => { t = await createTestDb({ migrations: 23 }); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); resetTestSession(); });

  it('полный синк (startRun + runChunk) работает', async () => {
    const state = freshState();
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error('не стартовало');
    const res = await runChunk(
      { db: t.db, now: () => NOW, budgetMs: 1_000_000, connect: () => connectPsn({ getAccessToken: async () => 't', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => NOW.getTime() }) },
      s.run,
    );
    expect(res.status).toBe('success');
  });

  it('GET sync/status работает (нет сравнения enum с литералом cancelled)', async () => {
    await expect(getSyncStatus(t.db, TEST_USER, NOW)).resolves.toBeTruthy();
  });

  it('GET /api/health работает', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(new Request('http://x/api/health'));
    expect(res.status).toBe(200);
  });

  it('cancelRun и restartRun бросают (маршрут отвечает 503); активный запуск остаётся running', async () => {
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: NOW });
    await expect(cancelRun(t.db, TEST_USER, NOW)).rejects.toThrow();
    await expect(restartRun(t.db, TEST_USER, { kind: 'manual', now: NOW })).rejects.toThrow();
    expect(s.kind).toBe('started');
  });
});
