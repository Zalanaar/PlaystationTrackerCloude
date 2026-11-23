import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { NotFoundError } from '@/server/collection/mutations';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { addDiaryEntry, deleteDiaryEntry, DiaryLimitError, DIARY_MAX_ENTRIES, listDiary, listDiaryInRange } from './diary';

const { allowedUsers, games, gameDiaryEntries, gameReviews } = schema;

describe('дневник прохождения', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).onConflictDoNothing();
  });

  async function game(name = 'Hades', userId = TEST_USER) {
    const [g] = await t.db.insert(games).values({
      userId, titleId: `CUSA-${name}-${userId}`, name, category: 'ps5_native_game', lastSeenAt: new Date(),
    }).returning();
    return g;
  }

  it('добавляет и удаляет заметки; чужая игра — 404; лимит', async () => {
    const g = await game();
    const first = await addDiaryEntry(t.db, TEST_USER, g.id, 'Старт');
    expect(first).toEqual([expect.objectContaining({ body: 'Старт' })]);
    const two = await addDiaryEntry(t.db, TEST_USER, g.id, 'Финал');
    expect(two.map((x) => x.body)).toEqual(['Старт', 'Финал']);

    const left = await deleteDiaryEntry(t.db, TEST_USER, g.id, first[0].id);
    expect(left.map((x) => x.body)).toEqual(['Финал']);
    await expect(deleteDiaryEntry(t.db, TEST_USER, g.id, first[0].id)).rejects.toBeInstanceOf(NotFoundError);

    const other = await game('Other', TEST_USER_2);
    await expect(addDiaryEntry(t.db, TEST_USER, other.id, 'нет')).rejects.toBeInstanceOf(NotFoundError);
    await addDiaryEntry(t.db, TEST_USER_2, other.id, 'Чужая');
    expect((await listDiary(t.db, TEST_USER, g.id)).map((x) => x.body)).toEqual(['Финал']);
    expect((await listDiary(t.db, TEST_USER_2, other.id)).map((x) => x.body)).toEqual(['Чужая']);
  });

  it('переносит старую заметку отзыва при первом чтении', async () => {
    const g = await game();
    const at = new Date('2026-03-01T10:00:00Z');
    await t.db.insert(gameReviews).values({ userId: TEST_USER, gameId: g.id, rating: 8, note: 'Было круто', createdAt: at, updatedAt: at });
    const rows = await listDiary(t.db, TEST_USER, g.id);
    expect(rows).toEqual([expect.objectContaining({ body: 'Было круто', createdAt: at.toISOString() })]);
    // повторно не дублирует
    expect((await listDiary(t.db, TEST_USER, g.id))).toHaveLength(1);
    expect(await t.db.select().from(gameDiaryEntries)).toHaveLength(1);
  });

  it('заметки за период для «Итогов»', async () => {
    const g = await game();
    const inYear = new Date('2026-06-15T12:00:00Z');
    const outYear = new Date('2025-12-31T20:00:00Z');
    await t.db.insert(gameDiaryEntries).values([
      { userId: TEST_USER, gameId: g.id, body: 'В году', createdAt: inYear },
      { userId: TEST_USER, gameId: g.id, body: 'Ранее', createdAt: outYear },
    ]);
    const year = await listDiaryInRange(t.db, TEST_USER, new Date('2025-12-31T21:00:00Z'), new Date('2026-12-31T21:00:00Z'));
    expect(year.map((x) => x.body)).toEqual(['В году']);
    expect(year[0].title).toBe('Hades');
  });

  it('лимит 50', async () => {
    const g = await game();
    await t.db.insert(gameDiaryEntries).values(
      Array.from({ length: DIARY_MAX_ENTRIES }, (_, i) => ({ userId: TEST_USER, gameId: g.id, body: `n${i + 1}`, createdAt: new Date() })),
    );
    await expect(addDiaryEntry(t.db, TEST_USER, g.id, 'ещё')).rejects.toBeInstanceOf(DiaryLimitError);
  });
});
