// Пакет 5: запись «с другой платформы» — статус △ ○ □ ✕, оценка, заметка, платформа (PATCH); «Это та игра?» без автосклейки; скрытие после склейки.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { RunContext } from '@/server/sync/context';
import { manualMatchStep } from '@/server/sync/manual-match-step';
import { startRun } from '@/server/sync/runs';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { addOtherPlatform, listOtherPlatform, updateOtherPlatform } from './other-platform';
import { answerMatch, countMatches, listMatches, ManualNotFoundError } from './store';
import { parseOtherPlatformPatch } from './validation';

const { games, gameStatus, allowedUsers, manualGames, syncRuns, otherPlatformMeta } = schema;
const U1 = TEST_USER;
const U2 = asUserId(2);
const NOW = new Date('2026-11-02T09:00:00Z');
const LATER = new Date('2026-11-03T09:00:00Z');
const played = new Date('2026-10-30T10:00:00Z');
const op = (id: string, title = `Game ${id}`) => ({ kind: 'other_platform' as const, externalSource: 'rawg' as const, externalId: id, title, coverUrl: null, releaseDate: null, platformLabel: 'Nintendo Switch' });

describe('PATCH-валидация пакета 5', () => {
  it('поля по одному, null очищает, пустая заметка = null, лишние поля и пустое тело = ошибка', () => {
    expect(parseOtherPlatformPatch({ status: 'completed' })).toEqual({ ok: true, value: { status: 'completed' } });
    expect(parseOtherPlatformPatch({ status: null, rating: null })).toEqual({ ok: true, value: { status: null, rating: null } });
    expect(parseOtherPlatformPatch({ platformLabel: 'Xbox' })).toEqual({ ok: true, value: { platformLabel: 'Xbox' } });
    expect(parseOtherPlatformPatch({ platformLabel: null })).toEqual({ ok: true, value: { platformLabel: null } });
    expect(parseOtherPlatformPatch({ note: '  ' })).toEqual({ ok: true, value: { note: null } });
    expect(parseOtherPlatformPatch({ rating: 10, note: ' ок ' })).toEqual({ ok: true, value: { rating: 10, note: 'ок' } });
    expect(parseOtherPlatformPatch({ status: 'completed', statusChangedAt: '2025-05-01T10:00:00.000Z' })).toEqual({ ok: true, value: { status: 'completed', statusChangedAt: new Date('2025-05-01T10:00:00.000Z') } });
    for (const bad of [{ statusChangedAt: '2025-05-01T10:00:00.000Z' }, { status: null, statusChangedAt: '2025-05-01T10:00:00.000Z' }, { status: 'completed', statusChangedAt: 'вчера' }, {}, { status: 'shelved' }, { rating: 11 }, { rating: 2.5 }, { note: 'x'.repeat(501) }, { hours: 3 }, { platformLabel: '' }, null]) {
      expect(parseOtherPlatformPatch(bad).ok).toBe(false);
    }
  });
});

describe('other_platform пакета 5 на БД', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.delete(manualGames);
  });
  async function addGame(userId: number, name: string, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `T${userId}-${name}`, name, psnGenres: ['ACTION'], ...o }).returning({ id: games.id });
    return g.id;
  }
  async function ctx(uid = U1) {
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    const s = await startRun(t.db, uid, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    return new RunContext(t.db, s.run, () => NOW, 1_000_000);
  }

  it('«Вернуть»: статус с прежней датой (не позже «сейчас»), оценка и заметка после повторного добавления', async () => {
    const { item } = await addOtherPlatform(t.db, U1, op('9'), NOW);
    const back = await updateOtherPlatform(t.db, U1, item.id, { status: 'completed', statusChangedAt: new Date('2025-05-01T10:00:00Z'), rating: 8, note: 'ок' }, NOW);
    expect(back).toMatchObject({ status: 'completed', statusChangedAt: '2025-05-01T10:00:00.000Z', rating: 8, note: 'ок' });
    const future = await updateOtherPlatform(t.db, U1, item.id, { status: 'dropped', statusChangedAt: new Date('2030-01-01T00:00:00Z') }, NOW);
    expect(future.statusChangedAt).toBe(NOW.toISOString());
  });

  it('статус, оценка, заметка, платформа; дата статуса только при смене; чужая запись = 404', async () => {
    const { item } = await addOtherPlatform(t.db, U1, op('1'), NOW);
    expect(item).toMatchObject({ status: null, statusChangedAt: null, rating: null, note: null });
    const a = await updateOtherPlatform(t.db, U1, item.id, { status: 'completed', rating: 8 }, NOW);
    expect(a).toMatchObject({ status: 'completed', statusChangedAt: NOW.toISOString(), rating: 8, note: null, platformLabel: 'Nintendo Switch' });
    const b = await updateOtherPlatform(t.db, U1, item.id, { status: 'completed', note: 'Хорошо', platformLabel: 'Switch' }, LATER);
    expect(b).toMatchObject({ status: 'completed', statusChangedAt: NOW.toISOString(), rating: 8, note: 'Хорошо', platformLabel: 'Switch' });
    const c = await updateOtherPlatform(t.db, U1, item.id, { status: 'dropped' }, LATER);
    expect(c).toMatchObject({ status: 'dropped', statusChangedAt: LATER.toISOString(), rating: 8, note: 'Хорошо' });
    const d = await updateOtherPlatform(t.db, U1, item.id, { status: null, rating: null }, LATER);
    expect(d).toMatchObject({ status: null, statusChangedAt: null, rating: null, note: 'Хорошо' });
    expect((await listOtherPlatform(t.db, U1))[0]).toMatchObject({ id: item.id, note: 'Хорошо' });
    await expect(updateOtherPlatform(t.db, U2, item.id, { status: 'playing' }, NOW)).rejects.toBeInstanceOf(ManualNotFoundError);
    expect(await t.db.select().from(otherPlatformMeta)).toHaveLength(1);
    // удаление записи удаляет и meta (каскад)
    await t.db.delete(manualGames).where(eq(manualGames.id, item.id));
    expect(await t.db.select().from(otherPlatformMeta)).toHaveLength(0);
  });

  it('«Это та игра?»: точное совпадение не склеивается само, а спрашивается; «да» скрывает запись и не ставит статус PS-игре', async () => {
    const gid = await addGame(1, 'Celeste', { lastPlayedAt: played });
    const { item } = await addOtherPlatform(t.db, U1, { ...op('7', 'Celeste') }, NOW).catch(async () => addOtherPlatform(t.db, U1, { ...op('7', 'Celeste'), confirmDuplicate: true }, NOW));
    const r = await manualMatchStep(await ctx());
    expect(r).toMatchObject({ linked: 0, suggested: 1 });
    expect(await countMatches(t.db, U1)).toBe(1);
    const [m] = await listMatches(t.db, U1);
    expect(m).toMatchObject({ id: item.id, kind: 'other_platform', platformLabel: 'Nintendo Switch', game: { gameId: gid } });
    await answerMatch(t.db, U1, item.id, 'yes', NOW);
    expect(await listOtherPlatform(t.db, U1)).toEqual([]);
    expect(await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, gid))).toEqual([]);
    await expect(updateOtherPlatform(t.db, U1, item.id, { status: 'playing' }, NOW)).rejects.toBeInstanceOf(ManualNotFoundError);
    // повторное явное добавление возвращает запись в блок; пара больше не предлагается
    const again = await addOtherPlatform(t.db, U1, op('7', 'Celeste'), LATER);
    expect(again.created).toBe(false);
    expect((await listOtherPlatform(t.db, U1)).map((x) => x.id)).toEqual([item.id]);
    await manualMatchStep(await ctx());
    expect(await countMatches(t.db, U1)).toBe(0);
  });

  it('«нет»: запись остаётся, вопрос не повторяется', async () => {
    await addGame(1, 'Hollow Knight', { lastPlayedAt: played });
    const { item } = await addOtherPlatform(t.db, U1, { ...op('8', 'Hollow Knight'), confirmDuplicate: true }, NOW);
    await manualMatchStep(await ctx());
    await answerMatch(t.db, U1, item.id, 'no', NOW);
    await manualMatchStep(await ctx());
    expect(await countMatches(t.db, U1)).toBe(0);
    expect((await listOtherPlatform(t.db, U1)).map((x) => x.id)).toEqual([item.id]);
  });
});
