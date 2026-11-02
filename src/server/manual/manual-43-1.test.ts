// Фаза 43.1: «Купил» при добавлении, пакет, подсказки (кэш, префикс), мягкий предел подсказок.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { resetSuggestQuotaMemory, suggestDailyLimit, takeSuggestQuota } from '@/server/usage/suggest-quota';
import { filterByQuery, suggestPlayStation, type SuggestCache } from './search';
import { addManual, addManualBatch, listManual, MANUAL_LIMIT } from './store';
import { parseManualAddBody, parseManualBatchBody, parseManualSearchParams } from './validation';

const U1 = TEST_USER;
const U2 = asUserId(2);
const NOW = new Date('2026-11-02T09:00:00Z');
const add = (id: string, o: Record<string, unknown> = {}) => ({ externalSource: 'rawg' as const, externalId: id, title: `Game ${id}`, coverUrl: null, releaseDate: null, ...o });

describe('валидация 43.1', () => {
  it('notPurchased boolean, лишнее и не boolean = ошибка', () => {
    expect(parseManualAddBody(add('1', { notPurchased: false })).ok).toBe(true);
    expect(parseManualAddBody(add('1', { notPurchased: 'no' })).ok).toBe(false);
  });
  it('пакет: 1..10, строгие элементы', () => {
    expect(parseManualBatchBody({ items: [] }).ok).toBe(false);
    expect(parseManualBatchBody({ items: Array.from({ length: 10 }, (_, i) => add(String(i))) }).ok).toBe(true);
    expect(parseManualBatchBody({ items: Array.from({ length: 11 }, (_, i) => add(String(i))) }).ok).toBe(false);
    expect(parseManualBatchBody({ items: [add('1', { x: 1 })] }).ok).toBe(false);
    expect(parseManualBatchBody({ items: [add('1')], extra: 1 }).ok).toBe(false);
  });
  it('режим поиска: suggest от 3 символов, Enter от 2, чужой mode = ошибка', () => {
    const sp = (s: string) => new URLSearchParams(s);
    expect(parseManualSearchParams(sp('q=ha&mode=suggest')).ok).toBe(false);
    expect(parseManualSearchParams(sp('q=had&mode=suggest'))).toEqual({ ok: true, value: { q: 'had', suggest: true } });
    expect(parseManualSearchParams(sp('q=ha'))).toEqual({ ok: true, value: { q: 'ha', suggest: false } });
    expect(parseManualSearchParams(sp('q=had&mode=x')).ok).toBe(false);
  });
});

describe('«Купил» и пакет на БД', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.delete(schema.manualGames);
  });

  it('notPurchased=false: запись без пометки, по умолчанию true, повтор не меняет флаг', async () => {
    const a = await addManual(t.db, U1, { ...add('1'), notPurchased: false }, NOW);
    expect(a.item).toMatchObject({ notPurchased: false, status: 'backlog' });
    const b = await addManual(t.db, U1, add('2'), NOW);
    expect(b.item.notPurchased).toBe(true);
    const again = await addManual(t.db, U1, { ...add('2'), notPurchased: false }, NOW);
    expect([again.created, again.item.notPurchased]).toEqual([false, true]);
    expect(await listManual(t.db, U1, { nb: true })).toHaveLength(1);
  });

  it('повторное добавление склеенной записи применяет переданный флаг', async () => {
    const [g] = await t.db.insert(schema.games).values({ userId: 1, category: 'ps4_game', lastSeenAt: NOW, titleId: 'X', name: 'Hades II', lastPlayedAt: NOW }).returning({ id: schema.games.id });
    const a = await addManual(t.db, U1, { ...add('9', { title: 'Hades II' }), confirmDuplicate: true, notPurchased: false }, NOW);
    expect(a.item.notPurchased).toBe(false);
    await t.db.update(schema.manualGames).set({ linkedGameId: g.id, notPurchased: false });
    expect(await listManual(t.db, U1)).toHaveLength(0);
    const b = await addManual(t.db, U1, { ...add('9', { title: 'Hades II' }), confirmDuplicate: true, notPurchased: false }, NOW);
    expect([b.created, b.item.notPurchased]).toEqual([true, false]);
  });

  it('пакет: частичный успех, дубль библиотеки, повтор внутри пачки, идемпотентность', async () => {
    await t.db.insert(schema.games).values({ userId: 1, category: 'ps4_game', lastSeenAt: NOW, titleId: 'X', name: 'Owned Game' });
    const items = [add('1'), add('2', { title: 'Owned Game' }), add('1'), add('3', { notPurchased: false }), add('4', { title: 'Owned Game', confirmDuplicate: true })];
    const r = await addManualBatch(t.db, U1, items, NOW);
    expect(r.map((x) => x.status)).toEqual(['created', 'duplicate', 'exists', 'created', 'created']);
    expect(r[1]).toMatchObject({ code: 'duplicate_game', details: { duplicate: 'library' } });
    expect(r.map((x) => x.index)).toEqual([0, 1, 2, 3, 4]);
    expect((await listManual(t.db, U1)).map((x) => x.externalId).sort()).toEqual(['1', '3', '4']);
    const r2 = await addManualBatch(t.db, U1, [add('1'), add('3'), add('4', { title: 'Owned Game', confirmDuplicate: true })], NOW);
    expect(r2.map((x) => x.status)).toEqual(['exists', 'exists', 'exists']);
  });

  it('общий лимит 200: ранее созданные остаются, лишние = error/manual_limit, exists проходит', async () => {
    await t.db.insert(schema.manualGames).values(Array.from({ length: MANUAL_LIMIT - 1 }, (_, i) => ({ userId: 1, rawgId: `s${i}`, title: `S${i}`, kind: 'ps_backlog' as const, notPurchased: true })));
    const r = await addManualBatch(t.db, U1, [add('a'), add('b'), add('s0')], NOW);
    expect(r.map((x) => (x.status === 'error' ? `${x.status}:${x.code}` : x.status))).toEqual(['created', 'error:manual_limit', 'exists']);
    expect(await listManual(t.db, U1)).toHaveLength(MANUAL_LIMIT);
  });

  it('изоляция: пачка пишет только в профиль, чужие записи не видны и не «exists»', async () => {
    await addManualBatch(t.db, U2, [add('1'), add('2')], NOW);
    const r = await addManualBatch(t.db, U1, [add('1')], NOW);
    expect(r[0].status).toBe('created');
    expect(await listManual(t.db, U1)).toHaveLength(1);
    expect(await listManual(t.db, U2)).toHaveLength(2);
  });
});

describe('подсказки: кэш', () => {
  const cand = (id: number, title: string) => ({ id, name: title, released: '2020-01-01', background_image: null, platforms: [{ platform: { name: 'PlayStation 5', slug: 'playstation5' } }] });
  function mk(results: ReturnType<typeof cand>[]) {
    const urls: string[] = [];
    const f = (async (u: URL) => (urls.push(String(u)), new Response(JSON.stringify({ results })))) as unknown as typeof fetch;
    return { f, urls };
  }
  it('page_size=8, второй такой же запрос из кэша без reserve', async () => {
    const { f, urls } = mk([cand(1, 'Hades'), cand(2, 'Hades II')]);
    const cache: SuggestCache = new Map();
    let reserved = 0;
    const deps = { apiKey: 'k', fetch: f, suggestCache: cache, now: NOW, reserve: async () => (reserved++, true) };
    const a = await suggestPlayStation('Had', deps);
    const b = await suggestPlayStation('had ', deps);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('page_size=8');
    expect([a.cached, b.cached, reserved]).toEqual([false, true, 1]);
  });
  it('префикс: полная короткая выдача фильтруется локально, без запроса и reserve', async () => {
    const { f, urls } = mk([cand(1, 'Hades'), cand(2, 'Hades II'), cand(3, 'Hadean Tactics')]);
    const cache: SuggestCache = new Map();
    let reserved = 0;
    const deps = { apiKey: 'k', fetch: f, suggestCache: cache, now: NOW, reserve: async () => (reserved++, true) };
    await suggestPlayStation('had', deps);
    const r = await suggestPlayStation('hades i', deps);
    expect(r.cached).toBe(true);
    expect(r.candidates.map((c) => c.externalId)).toEqual(['2']);
    expect([urls.length, reserved]).toEqual([1, 1]);
  });
  it('префикс: обрезанная выдача (8 штук) не используется, идёт запрос; протухший кэш тоже', async () => {
    const full = Array.from({ length: 8 }, (_, i) => cand(i + 1, `Hades ${i}`));
    const { f, urls } = mk(full);
    const cache: SuggestCache = new Map();
    const deps = { apiKey: 'k', fetch: f, suggestCache: cache, now: NOW, reserve: async () => true };
    await suggestPlayStation('had', deps);
    await suggestPlayStation('hade', deps);
    expect(urls).toHaveLength(2);
    await suggestPlayStation('hade', { ...deps, now: new Date(NOW.getTime() + 11 * 60_000) });
    expect(urls).toHaveLength(3);
  });
  it('filterByQuery: все токены, регистр и пунктуация не мешают', () => {
    const c = [{ externalSource: 'rawg' as const, externalId: '1', title: "Marvel's Spider-Man 2", releaseDate: null, coverUrl: null, platforms: [], playstation: true }];
    expect(filterByQuery(c, 'spider man')).toHaveLength(1);
    expect(filterByQuery(c, 'spider x')).toHaveLength(0);
  });
});

describe('мягкий предел подсказок', () => {
  beforeEach(() => resetSuggestQuotaMemory());
  const base = { userId: U1, now: NOW, suggestLimit: 3, rawgUserLimit: 60, rawgUsedToday: 0 };
  it('считает по профилю и суткам', () => {
    expect([1, 2, 3, 4].map(() => takeSuggestQuota(base))).toEqual([true, true, true, false]);
    expect(takeSuggestQuota({ ...base, userId: U2 })).toBe(true);
    expect(takeSuggestQuota({ ...base, now: new Date('2026-11-03T09:00:00Z') })).toBe(true);
  });
  it('не заходит за 80% общего лимита RAWG профиля (остаток для «У тебя нет» и Плана)', () => {
    expect(takeSuggestQuota({ ...base, rawgUsedToday: 47 })).toBe(true);
    expect(takeSuggestQuota({ ...base, rawgUsedToday: 48 })).toBe(false);
  });
  it('лимит из env: по умолчанию 30, не больше половины лимита RAWG, 0 выключает, мусор = по умолчанию', () => {
    expect(suggestDailyLimit(undefined, 60)).toBe(30);
    expect(suggestDailyLimit('100', 60)).toBe(30);
    expect(suggestDailyLimit('0', 60)).toBe(0);
    expect(suggestDailyLimit('abc', 20)).toBe(10);
    expect(takeSuggestQuota({ ...base, suggestLimit: 0 })).toBe(false);
  });
});
