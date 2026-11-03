// F1: оценка 0–10 и заметка (контракт F1) на PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getGameDetails } from './details';
import { NotFoundError } from './mutations';
import { getGamesByIds, listGames } from './query';
import { getReview, NOTE_MAX, parseReviewBody, setReview } from './reviews';
import { parseListQuery } from './validation';

const { games, gameReviews } = schema;
const NOW = new Date('2026-11-03T10:00:00Z');

describe('parseReviewBody', () => {
  it('оценка: целое 0..10 или null; 0 — настоящая оценка', () => {
    expect(parseReviewBody({ rating: 0 })).toEqual({ ok: true, value: { rating: 0 } });
    expect(parseReviewBody({ rating: 10 })).toEqual({ ok: true, value: { rating: 10 } });
    expect(parseReviewBody({ rating: null })).toEqual({ ok: true, value: { rating: null } });
    for (const rating of [-1, 11, 7.5, '7', true, Number.NaN]) expect(parseReviewBody({ rating }).ok, String(rating)).toBe(false);
  });
  it('заметка: trim, пустая = null, ≤500 кодовых точек, CRLF -> LF', () => {
    expect(parseReviewBody({ note: '  хорошо \r\n ' })).toEqual({ ok: true, value: { note: 'хорошо' } });
    expect(parseReviewBody({ note: 'a\r\nb' })).toEqual({ ok: true, value: { note: 'a\nb' } });
    expect(parseReviewBody({ note: '   ' })).toEqual({ ok: true, value: { note: null } });
    expect(parseReviewBody({ note: '😀'.repeat(NOTE_MAX) }).ok).toBe(true);
    expect(parseReviewBody({ note: 'x'.repeat(NOTE_MAX + 1) }).ok).toBe(false);
    expect(parseReviewBody({ note: 5 }).ok).toBe(false);
  });
  it('пустое тело, лишние поля и не объект = ошибка', () => {
    for (const b of [{}, { rating: 1, extra: 1 }, null, [], 'x']) expect(parseReviewBody(b).ok).toBe(false);
  });
});

describe('setReview / getReview', () => {
  let t: TestDb;
  let a: number;
  let b: number;
  let dup: number;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    const base = { userId: 1, category: 'ps5_native_game', lastSeenAt: NOW };
    const ins = await t.db
      .insert(games)
      .values([{ ...base, titleId: 'A', name: 'Alpha' }, { ...base, titleId: 'B', name: 'Bravo' }])
      .returning({ id: games.id });
    [a, b] = ins.map((r) => r.id);
    const [d] = await t.db.insert(games).values({ ...base, category: 'ps4_game', titleId: 'A4', name: 'Alpha PS4', duplicateOfGameId: a }).returning({ id: games.id });
    dup = d.id;
  });

  it('частичная правка: оценка и заметка не затирают друг друга; оба null = строка удалена', async () => {
    expect(await getReview(t.db, TEST_USER, a)).toBeNull();
    expect((await setReview(t.db, TEST_USER, a, { rating: 0 }, NOW)).review).toEqual({ rating: 0, note: null, updatedAt: NOW.toISOString() });
    expect((await setReview(t.db, TEST_USER, a, { note: 'Финал слабый' }, NOW)).review).toMatchObject({ rating: 0, note: 'Финал слабый' });
    expect((await setReview(t.db, TEST_USER, a, { rating: null }, NOW)).review).toMatchObject({ rating: null, note: 'Финал слабый' });
    expect((await setReview(t.db, TEST_USER, a, { note: null }, NOW)).review).toBeNull();
    expect(await t.db.select().from(gameReviews)).toHaveLength(0);
  });

  it('дубль пишется на главную карточку', async () => {
    const r = await setReview(t.db, TEST_USER, dup, { rating: 8 }, NOW);
    expect(r.gameId).toBe(a);
    expect((await getReview(t.db, TEST_USER, a))?.rating).toBe(8);
  });

  it('чужая и несуществующая игра = NotFoundError', async () => {
    await expect(setReview(t.db, 2 as typeof TEST_USER, a, { rating: 5 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setReview(t.db, TEST_USER, 999999, { rating: 5 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('CHECK в БД: оценка вне 0..10 и пустая строка не пишутся', async () => {
    await expect(t.db.insert(gameReviews).values({ userId: 1, gameId: a, rating: 11 })).rejects.toThrow();
    await expect(t.db.insert(gameReviews).values({ userId: 1, gameId: a })).rejects.toThrow();
    await expect(t.db.insert(gameReviews).values({ userId: 1, gameId: a, note: '' })).rejects.toThrow();
  });

  it('rating в GameItem, review в деталях, сортировка по оценке (без оценки — в конце)', async () => {
    await setReview(t.db, TEST_USER, b, { rating: 9, note: 'Шедевр' }, NOW);
    await setReview(t.db, TEST_USER, a, { rating: 0 }, NOW);
    const items = await getGamesByIds(t.db, TEST_USER, [a, b, dup]);
    expect(items.map((g) => g.rating)).toEqual([0, 9, null]);
    const det = await getGameDetails(t.db, TEST_USER, b);
    expect(det?.review).toEqual({ rating: 9, note: 'Шедевр', updatedAt: NOW.toISOString() });
    expect((await getGameDetails(t.db, TEST_USER, dup))?.review).toBeNull();
    const p = parseListQuery(new URLSearchParams('sort=rating'));
    if (!p.ok) throw new Error(p.message);
    const list = await listGames(t.db, TEST_USER, p.value, NOW);
    expect(list.items.map((g) => g.title)).toEqual(['Bravo', 'Alpha']);
    const asc = parseListQuery(new URLSearchParams('sort=rating&order=asc'));
    if (!asc.ok) throw new Error(asc.message);
    expect((await listGames(t.db, TEST_USER, asc.value, NOW)).items.map((g) => g.title)).toEqual(['Alpha', 'Bravo']);
  });

  it('удаление игры каскадно удаляет отзыв', async () => {
    await setReview(t.db, TEST_USER, b, { rating: 3 }, NOW);
    const { eq } = await import('drizzle-orm');
    await t.db.delete(games).where(eq(games.id, b));
    expect(await t.db.select().from(gameReviews)).toHaveLength(0);
  });
});
