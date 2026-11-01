// QA-28: дополнительные сценарии «Входящих» (первая загрузка после сбойного первого синка, МСК-граница недели).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { getInbox } from './query';

const { games, syncRuns } = schema;
const NOW = new Date('2026-11-01T12:00:00Z');
const hAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('QA-28 inbox', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  void sql;

  it.fails('QA-28-1 (баг, открыт): первый запуск упал (failed, 0 игр), второй импортирует всю библиотеку: «новых» быть не должно', async () => {
    await t.db.insert(syncRuns).values({ userId: TEST_USER, kind: 'daily', status: 'failed', errorReason: 'auth_expired', snapshotDate: '2026-11-01', startedAt: hAgo(30), finishedAt: hAgo(30) });
    await t.db.insert(syncRuns).values({ userId: TEST_USER, kind: 'manual', status: 'success', snapshotDate: '2026-11-01', startedAt: hAgo(5), finishedAt: hAgo(4.9) });
    for (let i = 0; i < 5; i++) await t.db.insert(games).values({ userId: TEST_USER, titleId: `G${i}`, name: `G${i}`, category: 'ps5_native_game', lastSeenAt: NOW, firstSeenAt: hAgo(5) });
    expect((await getInbox(t.db, TEST_USER, NOW)).newGames).toBe(0);
  });
});
