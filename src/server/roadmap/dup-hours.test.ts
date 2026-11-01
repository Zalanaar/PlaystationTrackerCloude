// Часы дубля PS4 (1 ч) суммируются в главную PS5 (10 ч) = 11 ч в Плане («сервисные игры») и в истории «Подскажи» (хвост QA 25-26).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { loadHistory } from '@/server/recommend/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { getServiceGames } from './db';

const { games, gameStatus } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('часы дублей в Плане и Подскажи', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seed(status: 'service' | 'completed') {
    const base = { userId: TEST_USER, lastSeenAt: NOW, psnGenres: ['ACTION'] };
    const [a] = await t.db.insert(games).values({ ...base, titleId: 'P5', name: 'Dup', category: 'ps5_native_game', playDurationSeconds: 36000 }).returning({ id: games.id });
    await t.db.insert(games).values({ ...base, titleId: 'P4', name: 'Dup', category: 'ps4_game', playDurationSeconds: 3600, duplicateOfGameId: a.id });
    await t.db.insert(gameStatus).values({ userId: TEST_USER, gameId: a.id, status });
    return a.id;
  }

  it('План: getServiceGames = 11 ч', async () => {
    await seed('service');
    const r = await getServiceGames(t.db, TEST_USER);
    expect(r).toHaveLength(1);
    expect(r[0].playedHours).toBe(11);
  });

  it('Подскажи: loadHistory.playSeconds = 11 ч', async () => {
    await seed('completed');
    const r = await loadHistory(t.db, TEST_USER);
    expect(r).toHaveLength(1);
    expect(r[0].playSeconds).toBe(39600);
  });
});
