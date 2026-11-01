// «Уже есть / проходил» (Фаза 40): изоляция по user_id, 1 -> много, отмена, исключение из выдач, вкус и скоринг не меняются.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { getDiscover, refreshDiscover, type DiscoverPayload } from '@/server/recommend/discover';
import { loadHistory } from '@/server/recommend/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { filterOwned, GameNotFoundError, listOwnedMarks, ownedRawgIds, recentCollections, removeOwnedMark, searchLibrary, upsertOwnedMark } from './marks';
import { parseOwnedMarkBody, parseSearchParams } from './validation';

const { games, gameStatus, allowedUsers, ownedMarks, recommendDiscoverCache } = schema;
const U2 = asUserId(2);
const NOW = new Date('2026-11-01T09:00:00Z');
const T = (n: number) => new Date(NOW.getTime() + n * 1000);
const KEY = 'rawg_SECRET_KEY';
const LIMITS = { userLimit: 60, totalLimit: 300 };

const covered = (id: string, gameId: number, title = `Game ${id}`) => ({ externalSource: 'rawg' as const, externalId: id, title, coverUrl: null, kind: 'covered' as const, coveredByGameId: gameId });
const standalone = (id: string, completed: boolean, title = `Game ${id}`) => ({ externalSource: 'rawg' as const, externalId: id, title, coverUrl: null, kind: 'not_in_library' as const, completed });

describe('owned_marks на БД', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function addGame(userId: number, name: string, extra: Partial<typeof games.$inferInsert> = {}, status: 'completed' | 'backlog' | null = null) {
    const [g] = await t.db.insert(games).values({ userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `T${userId}-${name}`, name, psnGenres: ['ACTION'], playDurationSeconds: 50 * 3600, ...extra }).returning({ id: games.id });
    if (status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status, statusChangedAt: NOW });
    return g.id;
  }

  it('covered: связывает с игрой библиотеки; повторный PUT меняет вид, created_at сохраняется', async () => {
    const g = await addGame(1, 'Uncharted: Legacy of Thieves Collection');
    const a = await upsertOwnedMark(t.db, TEST_USER, covered('100', g, 'Uncharted 3'), T(0));
    expect(a).toMatchObject({ externalId: '100', kind: 'covered', completed: false, coveredBy: { gameId: g, name: 'Uncharted: Legacy of Thieves Collection' } });
    const b = await upsertOwnedMark(t.db, TEST_USER, standalone('100', true, 'Uncharted 3'), T(60));
    expect(b).toMatchObject({ kind: 'not_in_library', completed: true, coveredBy: null, createdAt: a.createdAt });
    expect(b.updatedAt).toBe(T(60).toISOString());
    expect(await listOwnedMarks(t.db, TEST_USER)).toHaveLength(1);
  });

  it('изоляция: чужой и несуществующий game_id дают одну ошибку, запись не создаётся', async () => {
    const mine = await addGame(1, 'Mine');
    const theirs = await addGame(2, 'Theirs');
    await expect(upsertOwnedMark(t.db, TEST_USER, covered('1', theirs))).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(upsertOwnedMark(t.db, TEST_USER, covered('1', 99999))).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(upsertOwnedMark(t.db, U2, covered('1', mine))).rejects.toBeInstanceOf(GameNotFoundError);
    expect(await t.db.select().from(ownedMarks)).toHaveLength(0);
  });

  it('изоляция: нельзя удалить чужую отметку, списки и ключи не пересекаются, один rawg_id у двух', async () => {
    const g1 = await addGame(1, 'Collection A');
    const g2 = await addGame(2, 'Collection B');
    await upsertOwnedMark(t.db, TEST_USER, covered('7', g1));
    await upsertOwnedMark(t.db, U2, covered('7', g2));
    await upsertOwnedMark(t.db, U2, standalone('8', true));
    expect(await removeOwnedMark(t.db, TEST_USER, '8')).toBe(false); // 8 есть только у U2
    expect(await removeOwnedMark(t.db, U2, '9')).toBe(false);
    expect([...(await ownedRawgIds(t.db, TEST_USER))]).toEqual(['7']);
    expect([...(await ownedRawgIds(t.db, U2))].sort()).toEqual(['7', '8']);
    expect(await removeOwnedMark(t.db, TEST_USER, '7')).toBe(true);
    expect((await listOwnedMarks(t.db, U2)).map((m) => m.externalId).sort()).toEqual(['7', '8']);
    expect((await listOwnedMarks(t.db, U2)).find((m) => m.externalId === '7')?.coveredBy?.gameId).toBe(g2);
    expect(await filterOwned(t.db, TEST_USER, [{ externalId: '7' }, { externalId: '8' }])).toEqual([{ externalId: '7' }, { externalId: '8' }]);
  });

  it('1 -> много и приоритет недавних: порядок по последнему использованию, счётчик покрытых, скрытые и дубли не показываются', async () => {
    const a = await addGame(1, 'Collection A');
    const b = await addGame(1, 'Collection B');
    const hidden = await addGame(1, 'Hidden', { hiddenAt: NOW });
    const dup = await addGame(1, 'Collection A (PS4)', { duplicateOfGameId: a });
    await upsertOwnedMark(t.db, TEST_USER, covered('1', a), T(0));
    await upsertOwnedMark(t.db, TEST_USER, covered('2', a), T(10));
    await upsertOwnedMark(t.db, TEST_USER, covered('3', a), T(20));
    await upsertOwnedMark(t.db, TEST_USER, covered('4', b), T(30));
    await upsertOwnedMark(t.db, TEST_USER, covered('5', hidden), T(40));
    await upsertOwnedMark(t.db, TEST_USER, standalone('6', true), T(50));
    let rec = await recentCollections(t.db, TEST_USER, 5);
    expect(rec.map((r) => [r.gameId, r.coveredCount])).toEqual([[b, 1], [a, 3]]);
    // выбор сборника одним тапом для следующей игры двигает его наверх
    await upsertOwnedMark(t.db, TEST_USER, covered('9', a), T(60));
    rec = await recentCollections(t.db, TEST_USER, 5);
    expect(rec.map((r) => [r.gameId, r.coveredCount])).toEqual([[a, 4], [b, 1]]);
    expect(rec[0].lastUsedAt).toBe(T(60).toISOString());
    expect(await recentCollections(t.db, TEST_USER, 1)).toHaveLength(1);
    expect(await recentCollections(t.db, U2, 5)).toEqual([]);
    // выбор дубля пишется на главную
    const viaDup = await upsertOwnedMark(t.db, TEST_USER, covered('10', dup));
    expect(viaDup.coveredBy?.gameId).toBe(a);
  });

  it('поиск по библиотеке: подстрока без регистра, hltb_name, % и _ экранируются, скрытые/дубли/чужие не находятся, префикс первым', async () => {
    const own = await addGame(1, 'The Uncharted Collection');
    const pre = await addGame(1, 'Uncharted 4');
    await addGame(1, 'Hidden uncharted', { hiddenAt: NOW });
    await addGame(1, 'Uncharted dup', { duplicateOfGameId: pre });
    await addGame(2, 'Uncharted other user');
    await addGame(1, 'Other', { hltbName: 'Uncharted: Drake' });
    await addGame(1, '100% Orange Juice');
    await addGame(1, 'Totally Different');
    await upsertOwnedMark(t.db, TEST_USER, covered('1', own));
    const r = await searchLibrary(t.db, TEST_USER, 'UNCHARTED', 20);
    expect(r.map((x) => x.name)).toEqual(['Uncharted 4', 'Other', 'The Uncharted Collection']);
    expect(r.find((x) => x.id === own)?.coveredCount).toBe(1);
    expect((await searchLibrary(t.db, TEST_USER, '%', 20)).map((x) => x.name)).toEqual(['100% Orange Juice']);
    expect(await searchLibrary(t.db, TEST_USER, '_', 20)).toEqual([]);
    expect((await searchLibrary(t.db, U2, 'uncharted', 20)).map((x) => x.name)).toEqual(['Uncharted other user']);
    expect(await searchLibrary(t.db, TEST_USER, 'uncharted', 1)).toHaveLength(1);
  });

  it('БД: covered + completed запрещено; каскад по игре убирает covered, not_in_library остаётся', async () => {
    const g = await addGame(1, 'Collection');
    await upsertOwnedMark(t.db, TEST_USER, covered('1', g));
    await upsertOwnedMark(t.db, TEST_USER, standalone('2', true));
    await expect(t.db.update(ownedMarks).set({ completed: true }).where(eq(ownedMarks.rawgId, '1'))).rejects.toThrow();
    await t.db.delete(games).where(eq(games.id, g));
    expect((await listOwnedMarks(t.db, TEST_USER)).map((m) => m.externalId)).toEqual(['2']);
  });

  it('title_key нормализован, а исключение идёт по rawg_id, а не по названию', async () => {
    await upsertOwnedMark(t.db, TEST_USER, standalone('50', true, 'The Witcher 3: Wild Hunt - Complete Edition'));
    const [row] = await t.db.select().from(ownedMarks);
    expect(row.titleKey).toBe('witcher 3 wild hunt');
    const kept = await filterOwned(t.db, TEST_USER, [{ externalId: '50' }, { externalId: '51', title: 'The Witcher 3: Wild Hunt - Complete Edition' }]);
    expect(kept).toEqual([{ externalId: '51', title: 'The Witcher 3: Wild Hunt - Complete Edition' }]);
  });
});

describe('исключение из «У тебя нет» и вкус/скоринг', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const rawgGame = (id: number, name: string, mc: number, genre: string) => ({
    id, name, slug: name.toLowerCase().replace(/\W+/g, '-'), released: '2019-05-05', tba: false, background_image: `https://media.rawg.io/${id}.jpg`, rating: 4.2, metacritic: mc,
    platforms: [{ platform: { name: 'p', slug: 'playstation5' } }], genres: [{ slug: genre }], tags: [],
  });
  const POOL = {
    all: [rawgGame(1, 'Alpha Quest', 95, 'action'), rawgGame(2, 'Beta Strike', 88, 'shooter'), rawgGame(3, 'Gamma Ride', 80, 'racing'), rawgGame(4, 'Delta Blade', 92, 'action')],
    action: [rawgGame(1, 'Alpha Quest', 95, 'action'), rawgGame(4, 'Delta Blade', 92, 'action')],
  } as Record<string, ReturnType<typeof rawgGame>[]>;
  const fetchFn = (async (input: URL | string) => {
    const u = new URL(String(input));
    const facet = u.searchParams.get('genres') ?? 'all';
    return new Response(JSON.stringify({ next: null, results: POOL[facet] ?? [] }), { status: 200 });
  }) as typeof fetch;

  async function seedLibrary(userId: number) {
    const [g] = await t.db.insert(games).values({ userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `H${userId}`, name: `Hist${userId}`, psnGenres: ['ACTION'], playDurationSeconds: 90 * 3600 }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId, gameId: g.id, status: 'completed', statusChangedAt: NOW });
    return g.id;
  }
  const refresh = (userId: number) => refreshDiscover(t.db, asUserId(userId), NOW, { rawgKey: KEY, limits: LIMITS, llm: null, fetch: fetchFn });
  const payloadOf = async (userId: number) =>
    ((await t.db.select().from(recommendDiscoverCache).where(eq(recommendDiscoverCache.userId, userId)))[0].payload) as DiscoverPayload;
  const get = (userId: number) => getDiscover(t.db, asUserId(userId), NOW, { rawgKey: KEY, limits: LIMITS });

  it('отмеченные (covered и «прошёл») пропадают из выдачи сразу и из пересчёта; отмена возвращает', async () => {
    const g1 = await seedLibrary(1);
    await refresh(1);
    expect((await get(1)).items.map((i) => i.externalId).sort()).toEqual(['1', '2', '3', '4']);
    await upsertOwnedMark(t.db, TEST_USER, covered('1', g1, 'Alpha Quest'));
    await upsertOwnedMark(t.db, TEST_USER, standalone('2', true, 'Beta Strike'));
    // чтение: подборка в кэше не пересчитана, фильтр на чтении
    expect((await get(1)).items.map((i) => i.externalId).sort()).toEqual(['3', '4']);
    // чужая отметка не влияет
    await upsertOwnedMark(t.db, U2, standalone('3', true));
    expect((await get(1)).items.map((i) => i.externalId).sort()).toEqual(['3', '4']);
    // пересчёт: отмеченные остаются в кэше (скрыты на чтении), чтобы отмена возвращала их сразу
    await t.db.delete(recommendDiscoverCache);
    await refresh(1);
    expect((await payloadOf(1)).candidates.map((c) => c.externalId).sort()).toEqual(['1', '2', '3', '4']);
    expect((await get(1)).items.map((i) => i.externalId).sort()).toEqual(['3', '4']);
    // «Вернуть в подборку»/«Отменить»: следующая выдача содержит игру без пересчёта и без запросов RAWG
    await removeOwnedMark(t.db, TEST_USER, '2');
    expect((await get(1)).items.map((i) => i.externalId).sort()).toEqual(['2', '3', '4']);
    await removeOwnedMark(t.db, TEST_USER, '1');
    expect((await get(1)).items.map((i) => i.externalId).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('отмена у одного пользователя не возвращает игру другому', async () => {
    await seedLibrary(1);
    await seedLibrary(2);
    await refresh(1);
    await refresh(2);
    await upsertOwnedMark(t.db, TEST_USER, standalone('2', true, 'Beta Strike'));
    await upsertOwnedMark(t.db, U2, standalone('2', true, 'Beta Strike'));
    expect((await get(1)).items.map((i) => i.externalId)).not.toContain('2');
    expect((await get(2)).items.map((i) => i.externalId)).not.toContain('2');
    expect(await removeOwnedMark(t.db, TEST_USER, '2')).toBe(true);
    expect((await get(1)).items.map((i) => i.externalId)).toContain('2');
    expect((await get(2)).items.map((i) => i.externalId)).not.toContain('2');
  });

  it('вкус и скоринг не меняются: история та же, у остальных кандидатов тот же score, порядок и причины', async () => {
    await seedLibrary(1);
    await seedLibrary(2);
    const histBefore = await loadHistory(t.db, TEST_USER);
    await upsertOwnedMark(t.db, U2, standalone('1', true, 'Alpha Quest')); // «прошёл» у пользователя 2
    await upsertOwnedMark(t.db, U2, standalone('3', false, 'Gamma Ride'));
    expect(await loadHistory(t.db, U2)).toEqual((await loadHistory(t.db, TEST_USER)).map((h) => ({ ...h, id: expect.any(Number) })));
    expect(await loadHistory(t.db, TEST_USER)).toEqual(histBefore);
    await refresh(1);
    await refresh(2);
    const p1 = (await payloadOf(1)).candidates;
    const p2 = (await payloadOf(2)).candidates;
    expect(p2.map((c) => c.externalId)).toEqual(p1.map((c) => c.externalId));
    expect((await get(2)).items.map((i) => i.externalId)).toEqual(['4', '2']);
    const rest = p1;
    expect(p2).toEqual(rest.map((c) => ({ ...c, reason: { ...c.reason, text: c.reason.text.replace('Hist1', 'Hist2') } })));
    // отметка не создаёт ни статусов, ни игр, ни снимков
    expect(await t.db.select().from(games)).toHaveLength(2);
    expect(await t.db.select().from(gameStatus)).toHaveLength(2);
  });
});

describe('валидация', () => {
  it('тело: два вида, лишние и взаимоисключающие поля = ошибка', () => {
    expect(parseOwnedMarkBody(covered('1', 5)).ok).toBe(true);
    expect(parseOwnedMarkBody(standalone('1', false)).ok).toBe(true);
    expect(parseOwnedMarkBody({ ...covered('1', 5), completed: true }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...standalone('1', true), coveredByGameId: 5 }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...standalone('1', true), extra: 1 }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...standalone('1', true), kind: 'x' }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...standalone('a/b', true) }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...standalone('1', true), coverUrl: 'http://x/a.jpg' }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...covered('1', 0) }).ok).toBe(false);
    expect(parseOwnedMarkBody({ ...standalone('1', true), title: ' ' }).ok).toBe(false);
  });
  it('поиск: q 1..80, limit 1..30', () => {
    expect(parseSearchParams(new URLSearchParams('q=ab')).ok).toBe(true);
    expect(parseSearchParams(new URLSearchParams('')).ok).toBe(false);
    expect(parseSearchParams(new URLSearchParams(`q=${'x'.repeat(81)}`)).ok).toBe(false);
    expect(parseSearchParams(new URLSearchParams('q=a&limit=31')).ok).toBe(false);
    expect(parseSearchParams(new URLSearchParams('q=a&limit=0')).ok).toBe(false);
  });
});
