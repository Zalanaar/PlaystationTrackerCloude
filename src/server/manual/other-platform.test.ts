// Фаза 44: «Играл на другой платформе». Изоляция, идемпотентность, лимит, CHECK, несмешивание с ps_backlog,
// ноль влияния на Статистику, Итоги, Бэклог, План, прогнозы, «Подскажи»; исключение из «У тебя нет».
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { filterOwned, ownedRawgIds } from '@/server/owned/marks';
import { getRecommendations } from '@/server/recommend/db';
import { getRoadmap } from '@/server/roadmap/db';
import { getStats } from '@/server/stats/query';
import { getStatsAll } from '@/server/stats/all-query';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';
import { searchAnyPlatform, type SearchCache } from './search';
import { addOtherPlatform, listOtherPlatform, OTHER_PLATFORM_LIMIT, otherPlatformRawgIds } from './other-platform';
import { addManual, countMatches, flagCandidates, listManual, manualExists, ManualDuplicateError, ManualLimitError, removeManual, setNotPurchased, ManualNotFoundError } from './store';
import { parseAnyManualAddBody, parseKindParam, parseManualAddBody, parseManualSearchParams, parseOtherPlatformAddBody } from './validation';

const { games, gameStatus, allowedUsers, manualGames } = schema;
const U1 = TEST_USER;
const U2 = asUserId(2);
const U3 = asUserId(3); // дополнительный профиль входа U2
const NOW = new Date('2026-11-02T09:00:00Z');
const op = (id: string, extra: Record<string, unknown> = {}) => ({ kind: 'other_platform' as const, externalSource: 'rawg' as const, externalId: id, title: `Game ${id}`, coverUrl: null, releaseDate: '2024-05-01', platformLabel: 'Xbox Series S/X', ...extra });
const ps = (id: string) => ({ externalSource: 'rawg' as const, externalId: id, title: `PS ${id}`, coverUrl: null, releaseDate: null });

describe('валидация и поиск Фазы 44', () => {
  it('тело строгое, подпись 1..60 без управляющих символов', () => {
    expect(parseOtherPlatformAddBody(op('1')).ok).toBe(true);
    expect(parseOtherPlatformAddBody({ ...op('1'), platformLabel: undefined })).toMatchObject({ ok: true, value: { platformLabel: null } });
    expect(parseOtherPlatformAddBody({ ...op('1'), platformLabel: null })).toMatchObject({ ok: true, value: { platformLabel: null } });
    expect(parseOtherPlatformAddBody({ ...op('1'), platformLabel: '  PC  ' })).toMatchObject({ ok: true, value: { platformLabel: 'PC' } });
    for (const bad of ['', '   ', 'x'.repeat(61), 'a\nb', '<b>', 5]) expect(parseOtherPlatformAddBody({ ...op('1'), platformLabel: bad }).ok).toBe(false);
    expect(parseOtherPlatformAddBody({ ...op('1'), kind: 'ps_backlog' }).ok).toBe(false);
    expect(parseAnyManualAddBody(op('1'))).toMatchObject({ ok: true, value: { kind: 'other_platform' } });
    expect(parseAnyManualAddBody(ps('1'))).toMatchObject({ ok: true, value: { kind: 'ps_backlog' } });
    expect(parseAnyManualAddBody({ ...ps('1'), kind: 'ps_backlog' })).toMatchObject({ ok: true, value: { kind: 'ps_backlog' } });
    expect(parseAnyManualAddBody({ ...ps('1'), kind: 'x' }).ok).toBe(false);
    expect(parseKindParam(new URLSearchParams('kind=other_platform'))).toEqual({ ok: true, value: 'other_platform' });
    expect(parseKindParam(new URLSearchParams(''))).toEqual({ ok: true, value: 'ps_backlog' });
    expect(parseKindParam(new URLSearchParams('kind=x')).ok).toBe(false);
    expect(parseManualSearchParams(new URLSearchParams('q=halo&scope=all'))).toMatchObject({ ok: true, value: { scopeAll: true, suggest: false } });
    expect(parseManualSearchParams(new URLSearchParams('q=halo&scope=all&mode=suggest')).ok).toBe(false);
    expect(parseManualSearchParams(new URLSearchParams('q=halo&scope=zz')).ok).toBe(false);
    expect(parseOtherPlatformAddBody({ ...op('1'), notPurchased: true }).ok).toBe(false);
    expect(parseOtherPlatformAddBody({ ...op('1'), coverUrl: 'http://x' }).ok).toBe(false);
    expect(parseOtherPlatformAddBody({ ...op('1'), releaseDate: '2024-13-40' }).ok).toBe(false);
    expect(parseOtherPlatformAddBody({ ...op('1'), title: '' }).ok).toBe(false);
    // parseManualAddBody (Бэклог) по-прежнему не принимает чужие поля
    expect(parseManualAddBody({ ...ps('1'), kind: 'other_platform' }).ok).toBe(false);
    expect(parseManualAddBody({ ...ps('1'), platformLabel: 'PC' }).ok).toBe(false);
  });

  it('поиск без фильтра платформ, отдельный кэш, повтор не тратит лимит', async () => {
    let calls = 0;
    let reserved = 0;
    let url = '';
    const f = (async (u: URL) => {
      calls++;
      url = String(u);
      return new Response(JSON.stringify({ results: [{ id: 6, name: 'Hades PC', platforms: [{ platform: { name: 'PC', slug: 'pc' } }] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const cache: SearchCache = new Map();
    const deps = { apiKey: 'k', fetch: f, cache, now: NOW, reserve: async () => (reserved++, true) };
    const a = await searchAnyPlatform('Hades ', deps);
    const b = await searchAnyPlatform('hades', deps);
    expect(url).not.toContain('platforms=');
    expect(a.candidates.map((c) => c.externalId)).toEqual(['6']);
    expect([a.cached, b.cached, calls, reserved]).toEqual([false, true, 1, 1]);
  });
});

describe('other_platform на БД', () => {
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

  it('добавление, список новыми сверху, идемпотентность по (user, rawg, kind)', async () => {
    const a = await addOtherPlatform(t.db, U1, op('10'), new Date('2026-11-01T00:00:00Z'));
    expect(a.created).toBe(true);
    expect(a.item).toMatchObject({ source: 'manual', kind: 'other_platform', externalId: '10', platformLabel: 'Xbox Series S/X', releaseDate: '2024-05-01' });
    const again = await addOtherPlatform(t.db, U1, op('10', { platformLabel: 'PC' }), NOW);
    expect(again.created).toBe(false);
    expect(again.item).toEqual(a.item); // подпись не перезаписывается
    await addOtherPlatform(t.db, U1, op('11', { platformLabel: null }), NOW);
    expect((await listOtherPlatform(t.db, U1)).map((x) => [x.externalId, x.platformLabel])).toEqual([['11', null], ['10', 'Xbox Series S/X']]);
    expect(await t.db.select().from(manualGames)).toHaveLength(2);
  });

  it('изоляция: чужой вход и другой профиль того же входа не видят, не удаляют, пересекаются независимо', async () => {
    const mine = (await addOtherPlatform(t.db, U1, op('10'), NOW)).item;
    for (const u of [U2, U3]) {
      expect(await listOtherPlatform(t.db, u)).toEqual([]);
      expect(await removeManual(t.db, u, mine.id)).toBe(false);
      expect(await otherPlatformRawgIds(t.db, u)).toEqual(new Set());
      expect(await ownedRawgIds(t.db, u)).toEqual(new Set());
      expect(await filterOwned(t.db, u, [{ externalId: '10' }])).toHaveLength(1);
    }
    const other = (await addOtherPlatform(t.db, U3, op('10'), NOW)).item; // тот же RAWG id у другого профиля независим
    expect(other.id).not.toBe(mine.id);
    expect(await removeManual(t.db, U3, other.id)).toBe(true);
    expect(await listOtherPlatform(t.db, U1)).toHaveLength(1);
  });

  it('лимит на профиль; повтор существующей записи при полном списке не падает', async () => {
    await t.db.insert(manualGames).values(Array.from({ length: OTHER_PLATFORM_LIMIT }, (_, i) => ({ userId: 1, rawgId: `L${i}`, title: `T${i}`, kind: 'other_platform' })));
    await expect(addOtherPlatform(t.db, U1, op('new'), NOW)).rejects.toMatchObject({ limit: 300 });
    expect((await addOtherPlatform(t.db, U1, op('L3'), NOW)).created).toBe(false);
    expect((await addOtherPlatform(t.db, U2, op('new'), NOW)).created).toBe(true); // лимит на профиль
    await expect(addOtherPlatform(t.db, U1, op('new'), NOW)).rejects.toBeInstanceOf(ManualLimitError);
    // записи ps_backlog лимит other_platform не расходуют, и наоборот
    expect((await addManual(t.db, U1, ps('new'), NOW)).created).toBe(true);
  });

  it('CHECK: not_purchased = true для other_platform запрещён; подпись 1..60; неизвестный kind запрещён', async () => {
    await expect(t.db.insert(manualGames).values({ userId: 1, rawgId: 'a', title: 'a', kind: 'other_platform', notPurchased: true })).rejects.toThrow();
    await expect(t.db.insert(manualGames).values({ userId: 1, rawgId: 'b', title: 'b', kind: 'other_platform', platformLabel: '' })).rejects.toThrow();
    await expect(t.db.insert(manualGames).values({ userId: 1, rawgId: 'c', title: 'c', kind: 'other', notPurchased: false })).rejects.toThrow();
    const item = (await addOtherPlatform(t.db, U1, op('ok'), NOW)).item;
    await expect(t.db.update(manualGames).set({ notPurchased: true }).where(eq(manualGames.id, item.id))).rejects.toThrow();
  });

  it('ps_backlog не затронут: одна игра в обоих списках, операции ходят только по своему kind', async () => {
    const back = (await addManual(t.db, U1, ps('10'), NOW)).item;
    const other = (await addOtherPlatform(t.db, U1, op('10'), NOW)).item; // тот же rawg_id, другой kind
    expect(other.id).not.toBe(back.id);
    expect((await listManual(t.db, U1)).map((x) => x.id)).toEqual([back.id]);
    expect((await listOtherPlatform(t.db, U1)).map((x) => x.id)).toEqual([other.id]);
    // операции Бэклога по id other_platform: как несуществующая запись
    expect(await manualExists(t.db, U1, other.id)).toBe(false);
    await expect(setNotPurchased(t.db, U1, other.id, true)).rejects.toBeInstanceOf(ManualNotFoundError);
    expect(await countMatches(t.db, U1)).toBe(0);
    // и наоборот
    // удаление одной не трогает другую
    expect(await removeManual(t.db, U1, other.id)).toBe(true);
    expect(await removeManual(t.db, U1, other.id)).toBe(false);
    expect(await removeManual(t.db, U1, other.id)).toBe(false);
    expect((await listManual(t.db, U1))[0]).toMatchObject({ id: back.id, notPurchased: true });
  });

  it('дубль с библиотекой и Планом: предупреждение, с confirmDuplicate создаётся; «Вернуть» после удаления; флаги поиска', async () => {
    await t.db.insert(games).values({ userId: 1, category: 'ps5_native_game', lastSeenAt: NOW, titleId: 'Z', name: 'Hades' });
    await expect(addOtherPlatform(t.db, U1, op('50', { title: 'Hades' }), NOW)).rejects.toBeInstanceOf(ManualDuplicateError);
    expect(await listOtherPlatform(t.db, U1)).toHaveLength(0);
    const r = await addOtherPlatform(t.db, U1, op('50', { title: 'Hades', confirmDuplicate: true }), NOW);
    expect(r.created).toBe(true);
    expect((await addOtherPlatform(t.db, U1, op('50', { title: 'Hades' }), NOW)).created).toBe(false); // повтор без подтверждения не падает
    expect(await removeManual(t.db, U1, r.item.id)).toBe(true);
    expect((await addOtherPlatform(t.db, U1, op('50', { title: 'Hades', confirmDuplicate: true }), NOW)).created).toBe(true); // «Вернуть»
    await addManual(t.db, U1, ps('60'), NOW);
    const f = await flagCandidates(t.db, U1, [{ externalId: '50', title: 'Hades' }, { externalId: '60', title: 'PS 60' }, { externalId: '70', title: 'Fresh' }]);
    expect(f.map((x) => [x.inList, x.inBacklog])).toEqual([[true, false], [false, true], [false, false]]);
  });

  it('нулевое влияние на Статистику, Итоги, Бэклог, План, прогнозы, «Подскажи»', async () => {
    const base = { userId: 1, category: 'ps5_native_game', lastSeenAt: NOW, psnGenres: ['ACTION'] };
    const [a, b, c] = await t.db
      .insert(games)
      .values([
        { ...base, titleId: 'A', name: 'Alpha', playDurationSeconds: 36_000, lastPlayedAt: new Date('2026-10-30T10:00:00Z'), hltbMainHours: 10 },
        { ...base, titleId: 'B', name: 'Bravo', hltbMainHours: 20 },
        { ...base, titleId: 'C', name: 'Charlie', hltbMainHours: 5 },
      ])
      .returning({ id: games.id });
    await t.db.insert(gameStatus).values([
      { userId: 1, gameId: a.id, status: 'completed', statusChangedAt: new Date('2026-10-30T10:00:00Z'), completedAt: new Date('2026-10-30T10:00:00Z') },
      { userId: 1, gameId: b.id, status: 'backlog', statusChangedAt: new Date('2025-10-01T00:00:00Z') },
      { userId: 1, gameId: c.id, status: 'backlog', statusChangedAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const snap = async () => ({
      year: await getStats(t.db, U1, { type: 'year', year: 2026, month: null }, NOW),
      month: await getStats(t.db, U1, { type: 'month', year: 2026, month: 10 }, NOW),
      all: await getStatsAll(t.db, U1, NOW),
      wrapped: await getWrapped(t.db, U1, 2026, 'me', NOW),
      roadmap: await getRoadmap(t.db, U1, NOW),
      advice: await getRecommendations(t.db, U1, 'any', NOW, { llm: null }),
      games: await t.db.select().from(games),
      statuses: await t.db.select().from(gameStatus),
    });
    const before = await snap();
    for (let i = 0; i < 12; i++) await addOtherPlatform(t.db, U1, op(`o${i}`, { title: i % 2 ? 'Alpha' : `Elden ${i}`, releaseDate: i < 3 ? '2027-01-01' : null, confirmDuplicate: true }), NOW);
    expect(await snap()).toEqual(before);
  });

  it('исключается из «У тебя нет» и подборки (любой kind); чужие профили не затронуты', async () => {
    await addOtherPlatform(t.db, U1, op('10'), NOW);
    await addManual(t.db, U1, ps('20'), NOW);
    expect(await ownedRawgIds(t.db, U1)).toEqual(new Set(['10', '20']));
    expect((await filterOwned(t.db, U1, [{ externalId: '10' }, { externalId: '11' }])).map((x) => x.externalId)).toEqual(['11']);
    expect(await filterOwned(t.db, U2, [{ externalId: '10' }])).toHaveLength(1);
  });
});
