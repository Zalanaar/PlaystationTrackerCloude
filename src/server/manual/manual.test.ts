// Фаза 43: «не куплено» в Бэклоге. Сопоставление (чистая часть), запись, дубли, изоляция профилей и входов,
// шаг синка (уверенное/неуверенное совпадение, идемпотентность), вопрос «Это та игра?», исключения, Статистика не меняется.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { getInbox } from '@/server/inbox/query';
import { filterOwned, ownedRawgIds, upsertOwnedMark } from '@/server/owned/marks';
import { getStats } from '@/server/stats/query';
import { RunContext } from '@/server/sync/context';
import { manualMatchStep } from '@/server/sync/manual-match-step';
import { startRun } from '@/server/sync/runs';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { buildGroups, decideMatch, tokensContained, type LibraryRow } from './match';
import { rawgResetAt, searchPlayStation, type SearchCache } from './search';
import { addManual, answerMatch, countMatches, flagCandidates, listManual, listMatches, ManualDuplicateError, ManualNotFoundError, manualExists, removeManual, setNotPurchased } from './store';
import { parseManualAddBody, parseNbFlag } from './validation';

const { games, gameStatus, allowedUsers, manualGames, plannedGames, syncRuns } = schema;
const U1 = TEST_USER;
const U2 = asUserId(2); // другой вход
const U3 = asUserId(3); // дополнительный профиль входа U2
const NOW = new Date('2026-11-02T09:00:00Z');
const add = (id: string, title = `Game ${id}`, extra: { confirmDuplicate?: boolean } = {}) =>
  ({ externalSource: 'rawg' as const, externalId: id, title, coverUrl: null, releaseDate: '2026-12-01', ...extra });

const row = (id: number, name: string, o: Partial<LibraryRow> = {}): LibraryRow => ({ id, name, imageUrl: null, duplicateOfGameId: null, hiddenAt: null, lastPlayedAt: null, playDurationSeconds: 0, ...o });
const played = new Date('2026-10-30T10:00:00Z');

describe('сопоставление (чистая часть)', () => {
  it('точное совпадение названия + запуск = уверенное; издание в названии не мешает', () => {
    const gs = buildGroups([row(1, "Marvel's Spider-Man: Miles Morales", { lastPlayedAt: played })]);
    expect(decideMatch({ title: "Marvel's Spider-Man Miles Morales" }, gs, null, [])).toEqual({ kind: 'confident', groupId: 1 });
    const ed = buildGroups([row(2, 'Dying Light 2 Stay Human', { playDurationSeconds: 60 })]);
    expect(decideMatch({ title: 'Dying Light 2 Stay Human - Deluxe Edition' }, ed, null, [])).toEqual({ kind: 'confident', groupId: 2 });
  });
  it('без запуска и часов пометка остаётся (ни автоснятия, ни вопроса)', () => {
    const gs = buildGroups([row(1, 'Hades')]);
    expect(decideMatch({ title: 'Hades' }, gs, null, [])).toEqual({ kind: 'none' });
  });
  it('неуверенное: название входит в другое, несколько точных; «Нет» запоминается', () => {
    const gs = buildGroups([row(1, 'Hades II', { lastPlayedAt: played })]);
    expect(decideMatch({ title: 'Hades' }, gs, null, [])).toEqual({ kind: 'suggest', groupId: 1 });
    expect(decideMatch({ title: 'Hades' }, gs, null, [1])).toEqual({ kind: 'none' });
    const two = buildGroups([row(1, 'Same', { lastPlayedAt: played }), row(2, 'Same', { lastPlayedAt: new Date('2026-10-31T00:00:00Z') })]);
    expect(decideMatch({ title: 'Same' }, two, null, [])).toEqual({ kind: 'suggest', groupId: 2 });
  });
  it('отметка owned_marks (RAWG id -> игра) уверенна, но «Нет» её тоже блокирует; скрытые игры не участвуют', () => {
    const gs = buildGroups([row(1, 'Совсем другое', { lastPlayedAt: played }), row(2, 'Ghost', { lastPlayedAt: played, hiddenAt: played })]);
    expect(decideMatch({ title: 'Anything' }, gs, 1, [])).toEqual({ kind: 'confident', groupId: 1 });
    expect(decideMatch({ title: 'Anything' }, gs, 1, [1])).toEqual({ kind: 'none' });
    expect(decideMatch({ title: 'Ghost' }, gs, null, [])).toEqual({ kind: 'none' });
  });
  it('дубли Фазы 23 склеены в главную: запуск любой версии считается', () => {
    const gs = buildGroups([row(1, 'Game X'), row(2, 'Game X', { duplicateOfGameId: 1, lastPlayedAt: played })]);
    expect(gs).toHaveLength(1);
    expect(decideMatch({ title: 'Game X' }, gs, null, [])).toEqual({ kind: 'confident', groupId: 1 });
  });
  it('tokensContained: короткие и равные не совпадают', () => {
    expect(tokensContained('god of war', 'god of war ragnarok')).toBe(true);
    expect(tokensContained('war', 'god of war')).toBe(false); // < 4 символов
    expect(tokensContained('a b', 'a b')).toBe(false);
  });
});

describe('валидация и поиск', () => {
  it('тело добавления строгое', () => {
    expect(parseManualAddBody(add('1')).ok).toBe(true);
    expect(parseManualAddBody({ ...add('1'), kind: 'other_platform' }).ok).toBe(false);
    expect(parseManualAddBody({ ...add('1'), releaseDate: '2026-13-40' }).ok).toBe(false);
    expect(parseManualAddBody({ ...add('1'), coverUrl: 'http://x' }).ok).toBe(false);
    expect(parseNbFlag(new URLSearchParams('nb=1'))).toEqual({ ok: true, value: true });
    expect(parseNbFlag(new URLSearchParams('nb=2')).ok).toBe(false);
  });
  it('поиск: PS-фильтр уходит в RAWG, кэш не тратит лимит, resetAt = начало суток МСК', async () => {
    let calls = 0;
    let reserved = 0;
    let url = '';
    const f = (async (u: URL) => {
      calls++;
      url = String(u);
      return new Response(JSON.stringify({ results: [{ id: 5, name: 'Hades', platforms: [{ platform: { name: 'PS5', slug: 'playstation5' } }] }, { id: 6, name: 'Hades PC', platforms: [{ platform: { name: 'PC', slug: 'pc' } }] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const cache: SearchCache = new Map();
    const deps = { apiKey: 'k', fetch: f, cache, now: NOW, reserve: async () => (reserved++, true) };
    const a = await searchPlayStation('Hades ', deps);
    const b = await searchPlayStation('hades', deps);
    expect(url).toContain('platforms=187%2C18');
    expect(a.candidates.map((c) => c.externalId)).toEqual(['5']);
    expect([a.cached, b.cached, calls, reserved]).toEqual([false, true, 1, 1]);
    expect(rawgResetAt(new Date('2026-11-02T22:00:00Z'))).toBe('2026-11-03T21:00:00.000Z'); // 03.11 00:00 МСК
  });
});

describe('manual_games на БД', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active', primaryUserId: 2, psnOnlineId: 'Second', psnAccountId: 'acc3' });
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
  async function ctx() {
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    const s = await startRun(t.db, U1, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    return new RunContext(t.db, s.run, () => NOW, 1_000_000);
  }

  it('добавление: backlog + «не куплено», source manual; повтор идемпотентен', async () => {
    const r = await addManual(t.db, U1, add('10', 'Hades II'), NOW);
    expect(r.created).toBe(true);
    expect(r.item).toMatchObject({ source: 'manual', kind: 'ps_backlog', status: 'backlog', notPurchased: true, externalId: '10', releaseDate: '2026-12-01', matchSuggestion: null });
    const again = await addManual(t.db, U1, add('10', 'Hades II'), NOW);
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(r.item.id);
    expect(await listManual(t.db, U1)).toHaveLength(1);
  });

  it('изоляция: профили и входы не видят и не меняют чужие записи', async () => {
    const mine = (await addManual(t.db, U1, add('10'), NOW)).item;
    for (const u of [U2, U3]) {
      expect(await listManual(t.db, u)).toEqual([]);
      expect(await manualExists(t.db, u, mine.id)).toBe(false);
      await expect(setNotPurchased(t.db, u, mine.id, false)).rejects.toBeInstanceOf(ManualNotFoundError);
      expect(await removeManual(t.db, u, mine.id)).toBe(false);
      expect(await ownedRawgIds(t.db, u)).toEqual(new Set());
    }
    // тот же RAWG id у другого профиля и входа допустим и независим
    const other = (await addManual(t.db, U3, add('10'), NOW)).item;
    expect(other.id).not.toBe(mine.id);
    expect((await listManual(t.db, U1))[0].notPurchased).toBe(true);
    await setNotPurchased(t.db, U3, other.id, false);
    expect((await listManual(t.db, U1))[0].notPurchased).toBe(true);
    expect((await listManual(t.db, U1, { nb: true }))).toHaveLength(1);
    expect((await listManual(t.db, U3, { nb: true }))).toHaveLength(0);
  });

  it('игра чужого профиля не склеивается и не предлагается', async () => {
    await addGame(2, 'Hades', { lastPlayedAt: played });
    await addManual(t.db, U1, add('10', 'Hades'), NOW);
    const r = await manualMatchStep(await ctx());
    expect(r).toEqual({ checked: 1, linked: 0, suggested: 0 });
    expect((await listManual(t.db, U1))[0].notPurchased).toBe(true);
  });

  it('«Купил» и «Отменить»: идемпотентно, запись остаётся в Бэклоге', async () => {
    const { item } = await addManual(t.db, U1, add('10'), NOW);
    expect((await setNotPurchased(t.db, U1, item.id, false)).notPurchased).toBe(false);
    expect((await setNotPurchased(t.db, U1, item.id, false)).notPurchased).toBe(false);
    expect((await listManual(t.db, U1, { nb: true }))).toHaveLength(0);
    expect((await listManual(t.db, U1))).toHaveLength(1);
    expect((await setNotPurchased(t.db, U1, item.id, true)).notPurchased).toBe(true);
    expect(await removeManual(t.db, U1, item.id)).toBe(true);
    expect(await removeManual(t.db, U1, item.id)).toBe(false);
  });

  it('дубль с библиотекой и с Планом: предупреждение, добавление только с confirmDuplicate', async () => {
    await addGame(1, 'The Last of Us Part II Remastered');
    await t.db.insert(plannedGames).values({ userId: 1, title: 'GTA VI', externalSource: 'rawg', externalId: '77', status: 'planned' });
    const lib = await addManual(t.db, U1, add('1', 'The Last of Us Part II Remastered')).catch((e) => e);
    expect(lib).toBeInstanceOf(ManualDuplicateError);
    expect((lib as ManualDuplicateError).info).toMatchObject({ duplicate: 'library', game: { name: 'The Last of Us Part II Remastered' } });
    const pl = await addManual(t.db, U1, add('77', 'Другое имя')).catch((e) => e);
    expect((pl as ManualDuplicateError).info).toMatchObject({ duplicate: 'planned', planned: { title: 'GTA VI' } });
    expect(await listManual(t.db, U1)).toHaveLength(0);
    expect((await addManual(t.db, U1, add('77', 'Другое имя', { confirmDuplicate: true }))).created).toBe(true);
    // у другого профиля те же игры дублем не считаются
    expect((await addManual(t.db, U3, add('1', 'The Last of Us Part II Remastered'))).created).toBe(true);
    const flags = await flagCandidates(t.db, U1, [{ externalId: '1', title: 'The Last of Us Part II Remastered' }, { externalId: '77', title: 'X' }, { externalId: '5', title: 'Fresh' }]);
    expect(flags.map((f) => [f.duplicate, f.inBacklog])).toEqual([['library', false], ['planned', true], [null, false]]);
  });

  it('синк: уверенное совпадение + запуск снимает пометку, переносит backlog, запись не показывается; идемпотентно', async () => {
    const rec = (await addManual(t.db, U1, add('10', 'Dying Light 2 Stay Human - Deluxe Edition'), new Date('2026-10-01T00:00:00Z'))).item;
    const gid = await addGame(1, 'Dying Light 2 Stay Human', { lastPlayedAt: played, playDurationSeconds: 3600 }); // игра появилась в библиотеке после добавления записи
    const r1 = await manualMatchStep(await ctx());
    expect(r1).toEqual({ checked: 1, linked: 1, suggested: 0 });
    expect(await listManual(t.db, U1)).toEqual([]);
    const [row1] = await t.db.select().from(manualGames).where(eq(manualGames.id, rec.id));
    expect(row1).toMatchObject({ linkedGameId: gid, notPurchased: false, suggestedGameId: null });
    const [st] = await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, gid));
    expect(st).toMatchObject({ status: 'backlog', userId: 1 });
    expect(st.statusChangedAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(await manualMatchStep(await ctx())).toEqual({ checked: 0, linked: 0, suggested: 0 });
    expect((await t.db.select().from(gameStatus)).length).toBe(1);
  });

  it('синк: у игры уже есть свой статус - он не затирается; без запуска пометка остаётся', async () => {
    const gid = await addGame(1, 'Alpha', { lastPlayedAt: played });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: gid, status: 'playing', statusChangedAt: NOW });
    const idle = await addGame(1, 'Beta');
    expect(idle).toBeGreaterThan(0);
    await t.db.insert(manualGames).values([
      { userId: 1, rawgId: '1', title: 'Alpha', kind: 'ps_backlog', notPurchased: true },
      { userId: 1, rawgId: '2', title: 'Beta', kind: 'ps_backlog', notPurchased: true },
    ]);
    await manualMatchStep(await ctx());
    expect((await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, gid)))[0].status).toBe('playing');
    const left = await listManual(t.db, U1);
    expect(left.map((x) => [x.title, x.notPurchased])).toEqual([['Beta', true]]);
  });

  it('синк: owned_marks (RAWG id -> игра) даёт уверенное совпадение при другом названии', async () => {
    const gid = await addGame(1, 'Uncharted: Legacy of Thieves Collection', { lastPlayedAt: played });
    const rec = await addManual(t.db, U1, add('300', 'Uncharted 4'), NOW);
    await upsertOwnedMark(t.db, U1, { externalSource: 'rawg', externalId: '300', title: 'Uncharted 4', coverUrl: null, kind: 'covered', coveredByGameId: gid });
    expect(rec.item.id).toBeGreaterThan(0);
    expect((await manualMatchStep(await ctx())).linked).toBe(1);
  });

  it('неуверенное: вопрос во «Входящих»; идемпотентно; «Нет» запоминает пару навсегда; «Да» склеивает', async () => {
    const gid = await addGame(1, 'Hades II', { lastPlayedAt: played, playDurationSeconds: 7200 });
    const { item } = await addManual(t.db, U1, add('10', 'Hades'), NOW);
    expect(await manualMatchStep(await ctx())).toEqual({ checked: 1, linked: 0, suggested: 1 });
    expect(await manualMatchStep(await ctx())).toEqual({ checked: 1, linked: 0, suggested: 1 });
    expect((await listManual(t.db, U1))[0]).toMatchObject({ notPurchased: true, matchSuggestion: { gameId: gid, name: 'Hades II' } });
    expect(await countMatches(t.db, U1)).toBe(1);
    expect(await countMatches(t.db, U2)).toBe(0);
    expect((await getInbox(t.db, U1, NOW)).matchCount).toBe(1);
    const [m] = await listMatches(t.db, U1);
    expect(m).toMatchObject({ id: item.id, title: 'Hades', game: { gameId: gid, hours: 2 } });
    // чужой профиль ответить не может
    await expect(answerMatch(t.db, U3, item.id, 'yes')).rejects.toBeInstanceOf(ManualNotFoundError);
    expect(await answerMatch(t.db, U1, item.id, 'no')).toEqual({ linked: null });
    expect(await countMatches(t.db, U1)).toBe(0);
    await manualMatchStep(await ctx());
    await manualMatchStep(await ctx());
    expect(await countMatches(t.db, U1)).toBe(0); // пара больше не предлагается
    await expect(answerMatch(t.db, U1, item.id, 'yes')).rejects.toBeInstanceOf(ManualNotFoundError);
    // другая запись: «Да»
    const g2 = await addGame(1, 'God of War Ragnarök', { lastPlayedAt: played });
    const r2 = (await addManual(t.db, U1, add('20', 'God of War'), NOW)).item;
    await manualMatchStep(await ctx());
    const ans = await answerMatch(t.db, U1, r2.id, 'yes', NOW);
    expect(ans.linked?.gameId).toBe(g2);
    expect((await listManual(t.db, U1)).map((x) => x.externalId)).toEqual(['10']);
    expect((await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, g2)))[0].status).toBe('backlog');
  });

  it('исключения: RAWG id записей скрывается из выдач; Статистика не меняется', async () => {
    const gid = await addGame(1, 'Alpha', { playDurationSeconds: 3600 * 10, lastPlayedAt: played });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: gid, status: 'completed', statusChangedAt: played, completedAt: played });
    const before = await getStats(t.db, U1, { type: 'year', year: 2026, month: null }, NOW);
    await addManual(t.db, U1, add('10', 'Fresh One'), NOW);
    expect(await ownedRawgIds(t.db, U1)).toEqual(new Set(['10']));
    expect((await filterOwned(t.db, U1, [{ externalId: '10' }, { externalId: '11' }])).map((c) => c.externalId)).toEqual(['11']);
    expect(await filterOwned(t.db, U2, [{ externalId: '10' }])).toHaveLength(1);
    expect(await getStats(t.db, U1, { type: 'year', year: 2026, month: null }, NOW)).toEqual(before);
    expect((await t.db.select().from(games)).length).toBe(1);
  });
});
