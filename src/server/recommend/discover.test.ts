// «У тебя нет» (Фаза 30, 30.2-30.5): пересчёт и выдача на PGlite с фейковым RAWG и LLM.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import type { LlmEnv } from '@/server/env';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { getFailStreak } from './budget';
import { dislikeExternal } from './discover-dislikes';
import { getDiscover, MAX_REQUESTS, parseReasons, refreshDiscover, type DiscoverDeps } from './discover';
import { LlmError, type PhraseProvider } from './phrase';

const { games, gameStatus, plannedGames, recommendDiscoverCache, recommendLlmUsage, providerUsage, allowedUsers } = schema;
const NOW = new Date('2026-10-31T09:00:00Z');
const KEY = 'rawg_SECRET_KEY';
const U2 = asUserId(2);
const LIMITS = { userLimit: 60, totalLimit: 300 };
const ENV: LlmEnv = { provider: 'groq', apiKey: 'gsk_SECRET', model: null, dailyLimit: 50 };

type G = { id: number; name: string; genres?: string[]; mc?: number | null; released?: string; slugs?: string[]; tags?: string[] };
const rawgGame = (g: G) => ({
  id: g.id, name: g.name, slug: g.name.toLowerCase().replace(/\W+/g, '-'), released: g.released ?? '2019-05-05', tba: false, background_image: `https://media.rawg.io/${g.id}.jpg`,
  rating: 4.31, metacritic: g.mc === undefined ? 90 : g.mc, platforms: (g.slugs ?? ['playstation5', 'playstation4']).map((s) => ({ platform: { name: s, slug: s } })),
  genres: (g.genres ?? ['action']).map((s) => ({ slug: s })), tags: (g.tags ?? []).map((s) => ({ slug: s })),
});

/** Фейковый RAWG: ответ по значению параметра genres/tags (`all` без фасета). */
function fakeRawg(byFacet: Record<string, G[]>, opts: { fail?: (facet: string) => 'http' | 'garbage' | 'throw' | null } = {}) {
  const urls: URL[] = [];
  const fetchFn = (async (input: URL | string) => {
    const u = new URL(String(input));
    urls.push(u);
    const facet = u.searchParams.get('genres') ?? (u.searchParams.get('tags') ? `tags:${u.searchParams.get('tags')}` : 'all');
    const f = opts.fail?.(facet);
    if (f === 'throw') throw new Error(`boom ${u.toString()}`);
    if (f === 'http') return new Response('x', { status: 500 });
    if (f === 'garbage') return new Response('not json', { status: 200 });
    return new Response(JSON.stringify({ next: null, results: (byFacet[facet] ?? []).map(rawgGame) }), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}

const llm = (text: (n: number) => string | Error): PhraseProvider & { calls: number; users: string[] } => {
  const p = {
    name: 'groq' as const, calls: 0, users: [] as string[],
    async complete({ user }: { system: string; user: string }) {
      p.calls++;
      p.users.push(user);
      const r = text(p.calls);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return p;
};
const goodLlm = (user: string) => JSON.stringify({ reasons: (JSON.parse(user) as { games: { id: number }[] }).games.map((g) => ({ id: g.id, text: `Подойдёт тебе ${g.id}.` })) });

describe('discover: пересчёт и выдача', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function addGame(userId: number, name: string, status: 'completed' | 'playing' | 'dropped' | 'backlog' | null, extra: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({
      userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `T${userId}-${name}`, name, psnGenres: ['ACTION'], playDurationSeconds: 50 * 3600, ...extra,
    }).returning({ id: games.id });
    if (status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status, statusChangedAt: NOW });
    return g.id;
  }
  const run = (deps: DiscoverDeps, userId = TEST_USER) => refreshDiscover(t.db, userId, NOW, { rawgKey: KEY, limits: LIMITS, llm: null, ...deps });
  const get = (userId = TEST_USER, now = NOW) => getDiscover(t.db, userId, now, { rawgKey: KEY, limits: LIMITS });
  const titles = async (userId = TEST_USER) => (await get(userId)).items.map((i) => i.title);

  it('ни одной игры библиотеки в выдаче: любой статус, скрытая, дубль, другое написание, hltb_name', async () => {
    await addGame(1, 'Elden Ring', 'completed');
    await addGame(1, 'Hades', 'backlog');
    await addGame(1, 'Control', null, { hiddenAt: NOW });
    const main = await addGame(1, 'Death Stranding', 'completed');
    await addGame(1, 'Death Stranding Director\'s Cut (PS4)', null, { duplicateOfGameId: main });
    await addGame(1, 'Совсем другое имя', 'backlog', { hltbName: 'Sekiro: Shadows Die Twice' });
    await addGame(1, 'The Witcher 3: Wild Hunt - Complete Edition', 'playing');
    const rawg = fakeRawg({
      all: [{ id: 1, name: 'Elden Ring' }, { id: 2, name: 'HADES' }, { id: 3, name: 'Control' }, { id: 4, name: 'Death Stranding' }, { id: 5, name: 'Death Stranding Director\'s Cut' },
        { id: 6, name: 'Sekiro: Shadows Die Twice' }, { id: 7, name: 'The Witcher 3: Wild Hunt' }, { id: 8, name: 'Bloodborne' }, { id: 9, name: 'Ghost of Tsushima' }],
      action: [{ id: 1, name: 'Elden Ring' }, { id: 8, name: 'Bloodborne' }, { id: 10, name: 'Nioh 2' }],
    });
    const r = await run({ fetch: rawg.fetch });
    expect(r.status).toBe('done');
    const out = (await titles()).sort();
    expect(out).toEqual(['Bloodborne', 'Ghost of Tsushima', 'Nioh 2']);
  });

  it('работает при выключенном LLM: причины шаблонные «Похожа на X и Y, жанр Z»', async () => {
    await addGame(1, 'Alpha', 'completed', { playDurationSeconds: 100 * 3600 });
    await addGame(1, 'Beta', 'completed', { playDurationSeconds: 80 * 3600 });
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }], all: [] });
    const r = await run({ fetch: rawg.fetch, llm: null });
    expect(r.llm).toBe('none');
    const d = await get();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].reason).toEqual({ text: 'Похожа на «Alpha» и «Beta», жанр «Экшен».', source: 'template' });
    expect(d.items[0]).toMatchObject({ externalSource: 'rawg', externalId: '10', platforms: ['PS5', 'PS4'], genres: ['ACTION'], metacritic: 90, rating: 4.3, rawgUrl: 'https://rawg.io/games/nioh-2', planned: false });
    expect(d.meta).toMatchObject({ catalog: 'ok', stale: false, partial: false, reason: null, total: 1, limit: 12 });
    expect((await t.db.select().from(recommendLlmUsage)).length).toBe(0);
  });

  it('запросы RAWG: PS5/PS4, порог метакритика, без DLC; ключ не попадает в кэш', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }] });
    await run({ fetch: rawg.fetch });
    const first = rawg.urls[0];
    expect(first.searchParams.get('platforms')).toBe('187,18');
    expect(first.searchParams.get('genres')).toBe('action');
    expect(first.searchParams.get('metacritic')).toBe('75,100');
    expect(first.searchParams.get('exclude_additions')).toBe('true');
    expect(rawg.urls.some((u) => !u.searchParams.has('genres') && !u.searchParams.has('tags'))).toBe(true); // общий фасет
    const row = (await t.db.select().from(recommendDiscoverCache))[0];
    expect(JSON.stringify(row)).not.toContain(KEY);
  });

  it('отсев записей RAWG: не вышла, нет PlayStation, метакритик ниже порога или пустой', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({
      action: [
        { id: 1, name: 'Future Game', released: '2027-01-01' }, { id: 2, name: 'Xbox Only', slugs: ['xbox-one'] }, { id: 3, name: 'Meh', mc: 70 },
        { id: 4, name: 'No Score', mc: null }, { id: 5, name: 'Good One', mc: 80 }, { id: 6, name: 'PS4 Only', slugs: ['playstation4'] },
      ],
    });
    await run({ fetch: rawg.fetch });
    expect((await titles()).sort()).toEqual(['Good One', 'PS4 Only']);
    expect((await get()).items.find((i) => i.title === 'PS4 Only')!.platforms).toEqual(['PS4']);
  });

  it('LLM формулирует причины (1 вызов), невалидные фразы заменяются шаблоном; повтор в те же сутки пропускается', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }, { id: 11, name: 'Bloodborne' }, { id: 12, name: 'Sekiro' }] });
    const provider: PhraseProvider & { calls: number } = {
      name: 'groq', calls: 0,
      async complete({ user }) {
        provider.calls++;
        const ids = (JSON.parse(user) as { games: { id: number; title: string }[] }).games;
        return JSON.stringify({ reasons: ids.map((g, i) => ({ id: g.id, text: i === 0 ? 'Смотри https://evil.example/x' : i === 1 ? 'x'.repeat(200) : `Хорошая ${g.title}.`.replace(g.title, 'игра') })) });
      },
    };
    const r = await run({ fetch: rawg.fetch, llm: ENV, provider });
    expect(r.llm).toBe('ok');
    expect(provider.calls).toBe(1);
    const items = (await get()).items;
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.reason.source === 'llm')).toHaveLength(1);
    expect(items.filter((i) => i.reason.source === 'template')).toHaveLength(2);
    expect(items.every((i) => !i.reason.text.includes('evil'))).toBe(true);
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ calls: 1, discoverAutoCalls: 1, phraseCalls: 0 });
    const again = await run({ fetch: rawg.fetch, llm: ENV, provider });
    expect(again.status).toBe('skipped');
    expect(provider.calls).toBe(1);
    expect(rawg.urls.length).toBeGreaterThan(0);
  });

  it('LLM не выбирает игры: чужие id и названия игнорируются, состав из RAWG', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }, { id: 11, name: 'Bloodborne' }] });
    const provider = llm(() => JSON.stringify({ games: [{ title: 'Выдуманная игра' }], reasons: [{ id: 99, text: 'Левая' }, { id: 0, text: 'Как Bloodborne, но лучше.' }, { id: 1, text: 'Нормальная фраза.' }] }));
    await run({ fetch: rawg.fetch, llm: ENV, provider });
    const items = (await get()).items;
    expect(items.map((i) => i.title).sort()).toEqual(['Bloodborne', 'Nioh 2']);
    const bySrc = Object.fromEntries(items.map((i) => [i.title, i.reason.source]));
    expect(Object.values(bySrc).filter((s) => s === 'llm')).toHaveLength(1); // фраза с названием другого кандидата отброшена
  });

  it('сбой LLM: шаблоны, вызов возвращён, неудача записана; пауза после 3 неудач', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }] });
    const bad = llm(() => new LlmError('http', 'http_429'));
    const r = await run({ fetch: rawg.fetch, llm: ENV, provider: bad });
    expect(r.llm).toBe('failed');
    expect(r.llmReason).toBe('http_429');
    expect((await get()).items[0].reason.source).toBe('template');
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ calls: 0, discoverAutoCalls: 0 });
    expect((await getFailStreak(t.db)).streak).toBe(1);
    // мусор вместо JSON
    await t.db.delete(recommendDiscoverCache);
    const junk = llm(() => 'не json');
    expect((await run({ fetch: rawg.fetch, llm: ENV, provider: junk })).llm).toBe('failed');
    // таймаут сети
    await t.db.delete(recommendDiscoverCache);
    const net = llm(() => new Error('network down'));
    expect((await run({ fetch: rawg.fetch, llm: ENV, provider: net })).llm).toBe('failed');
    expect((await getFailStreak(t.db)).streak).toBe(3);
    // пауза: LLM больше не зовём, подборка шаблонная
    await t.db.delete(recommendDiscoverCache);
    const spare = llm(() => goodLlm('{"games":[]}'));
    const r4 = await run({ fetch: rawg.fetch, llm: ENV, provider: spare });
    expect(spare.calls).toBe(0);
    expect(r4.llm).toBe('none');
    expect((await get()).items).toHaveLength(1);
  });

  it('потолок LLM вида discover = 1 вызов в сутки на пользователя', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }] });
    const p = llm(() => JSON.stringify({ reasons: [{ id: 0, text: 'Фраза.' }] }));
    await run({ fetch: rawg.fetch, llm: ENV, provider: p });
    await t.db.delete(recommendDiscoverCache); // принудительно считаем заново в те же сутки
    const r = await run({ fetch: rawg.fetch, llm: ENV, provider: p });
    expect(p.calls).toBe(1);
    expect(r.llmReason).toBe('limit');
    expect((await get()).items[0].reason.source).toBe('template');
  });

  it('лимит RAWG: запросы считаются в provider_usage, при исчерпании остановка, подборка partial и добор позже', async () => {
    await addGame(1, 'Alpha', 'completed');
    await addGame(1, 'Beta', 'completed', { psnGenres: ['ROLE_PLAYING_GAMES'] });
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }], 'role-playing-games-rpg': [{ id: 11, name: 'Persona 5', genres: ['role-playing-games-rpg'] }], all: [{ id: 12, name: 'Bloodborne' }] });
    const r = await run({ fetch: rawg.fetch, limits: { userLimit: 2, totalLimit: 300 } });
    expect(r.status).toBe('limit');
    expect(r.requests).toBe(2);
    expect(rawg.urls).toHaveLength(2);
    expect((await t.db.select().from(providerUsage))[0]).toMatchObject({ userId: 1, provider: 'rawg', calls: 2 });
    const d = await get();
    expect(d.meta.partial).toBe(true);
    expect(d.items.length).toBeGreaterThan(0);
    // позже (лимит снят): добираются только недостающие фасеты
    const before = rawg.urls.length;
    const r2 = await run({ fetch: rawg.fetch });
    expect(r2.status).toBe('done');
    expect(rawg.urls.length - before).toBe(1);
    expect((await get()).meta.partial).toBe(false);
    expect((await titles()).sort()).toEqual(['Bloodborne', 'Nioh 2', 'Persona 5']);
  });

  it('общий потолок RAWG по сумме пользователей и RAWG_DAILY_LIMIT=0 (каталог выключен)', async () => {
    await addGame(1, 'Alpha', 'completed');
    await addGame(2, 'Gamma', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }], all: [] });
    const lim = { userLimit: 60, totalLimit: 3 };
    const a = await run({ fetch: rawg.fetch, limits: lim }, TEST_USER); // action + all = 2 запроса
    expect(a.requests).toBe(2);
    const b = await run({ fetch: rawg.fetch, limits: lim }, U2); // остался 1
    expect(b.status).toBe('limit');
    expect(b.requests).toBe(1);
    const off = await run({ fetch: rawg.fetch, limits: { userLimit: 60, totalLimit: 0 } });
    expect(off.status).toBe('disabled');
    expect((await getDiscover(t.db, TEST_USER, NOW, { rawgKey: KEY, limits: { userLimit: 60, totalLimit: 0 } })).meta.catalog).toBe('unavailable');
  });

  it('не больше MAX_REQUESTS запросов за запуск', async () => {
    await addGame(1, 'Alpha', 'completed');
    // страницы не набирают 6 новых игр: добираются до 3 страниц на фасет
    const more = async () => new Response(JSON.stringify({ next: 'https://x/next', results: [] }), { status: 200 });
    const r = await run({ fetch: more as unknown as typeof fetch });
    expect(r.requests).toBeLessThanOrEqual(MAX_REQUESTS);
    expect(r.requests).toBe(6); // action x3 + all x3
  });

  it('нет ключа RAWG: шаг выключен, сеть не вызывается, выдача unavailable', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'X' }] });
    const r = await refreshDiscover(t.db, TEST_USER, NOW, { rawgKey: null, limits: LIMITS, llm: null, fetch: rawg.fetch });
    expect(r.status).toBe('disabled');
    expect(rawg.urls).toHaveLength(0);
    const d = await getDiscover(t.db, TEST_USER, NOW, { rawgKey: null, limits: LIMITS });
    expect(d).toEqual({ items: [], meta: expect.objectContaining({ catalog: 'unavailable', reason: null }) });
  });

  it('сбой RAWG: фасет повторится, прежняя подборка не затирается, секрет не утекает', async () => {
    await addGame(1, 'Alpha', 'completed');
    const ok = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }] });
    await run({ fetch: ok.fetch });
    await t.db.update(recommendDiscoverCache).set({ day: '2026-10-30' }); // вчерашняя подборка
    const broken = fakeRawg({}, { fail: () => 'throw' });
    const r = await run({ fetch: broken.fetch });
    expect(r.status).toBe('failed');
    expect(r.failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain(KEY);
    const d = await get();
    expect(d.items.map((i) => i.title)).toEqual(['Nioh 2']);
    expect(d.meta.stale).toBe(true);
    for (const mode of ['http', 'garbage'] as const) {
      const bad = fakeRawg({}, { fail: () => mode });
      const rr = await run({ fetch: bad.fetch });
      expect(rr.failures.length).toBeGreaterThan(0);
      expect(JSON.stringify(rr)).not.toMatch(/rawg_SECRET/);
    }
  });

  it('«Не интересно» и План убирают игру из выдачи сразу и надолго; отменённый План остаётся с plannedId', async () => {
    await addGame(1, 'Alpha', 'completed');
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }, { id: 11, name: 'Bloodborne' }, { id: 12, name: 'Sekiro' }, { id: 13, name: 'Control' }] });
    await run({ fetch: rawg.fetch });
    expect(await titles()).toHaveLength(4);
    await dislikeExternal(t.db, TEST_USER, { externalSource: 'rawg', externalId: '10', title: 'Nioh 2', coverUrl: null }, NOW);
    await t.db.insert(plannedGames).values({ userId: 1, title: 'Bloodborne', externalSource: 'rawg', externalId: '11', status: 'planned' });
    const [cancelled] = await t.db.insert(plannedGames).values({ userId: 1, title: 'Control', externalSource: 'rawg', externalId: '13', status: 'cancelled' }).returning({ id: plannedGames.id });
    const items = (await get()).items;
    expect(items.map((i) => i.title).sort()).toEqual(['Control', 'Sekiro']);
    expect(items.find((i) => i.title === 'Control')).toMatchObject({ planned: true, plannedId: cancelled.id });
    // отметка живёт 30 суток
    expect((await getDiscover(t.db, TEST_USER, new Date(NOW.getTime() + 29 * 86_400_000), { rawgKey: KEY, limits: LIMITS })).items.map((i) => i.title)).not.toContain('Nioh 2');
    // новый пересчёт не возвращает скрытое
    await t.db.delete(recommendDiscoverCache);
    await run({ fetch: rawg.fetch });
    expect((await titles()).sort()).toEqual(['Control', 'Sekiro']);
  });

  it('игра, добавленная в библиотеку после сборки, исчезает из выдачи без пересчёта', async () => {
    await addGame(1, 'Alpha', 'completed');
    await run({ fetch: fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }, { id: 11, name: 'Bloodborne' }] }).fetch });
    await addGame(1, 'Bloodborne', 'backlog');
    expect(await titles()).toEqual(['Nioh 2']);
  });

  it('пустая история: общий фасет, шаблон про рейтинг; нет подборки = not_generated; всё скрыто = no_candidates', async () => {
    expect((await get()).meta.reason).toBe('not_generated');
    const rawg = fakeRawg({ all: [{ id: 1, name: 'Bloodborne', genres: ['indie'] }] });
    await run({ fetch: rawg.fetch });
    expect(rawg.urls).toHaveLength(1);
    const d = await get();
    expect(d.items[0].reason.text).toBe('Высоко оценена на PlayStation: Metacritic 90.');
    expect(d.items[0].genres).toEqual([]);
    await dislikeExternal(t.db, TEST_USER, { externalSource: 'rawg', externalId: '1', title: 'Bloodborne', coverUrl: null }, NOW);
    expect((await get()).meta).toMatchObject({ reason: 'no_candidates', total: 1 });
  });

  it('изоляция: подборка, библиотека, дизлайки и счётчики пользователей не пересекаются', async () => {
    await addGame(1, 'Alpha', 'completed');
    await addGame(2, 'Gamma', 'completed');
    await addGame(2, 'Bloodborne', 'completed'); // есть только у пользователя 2
    const rawg = fakeRawg({ action: [{ id: 10, name: 'Nioh 2' }, { id: 11, name: 'Bloodborne' }] });
    await run({ fetch: rawg.fetch }, TEST_USER);
    expect((await titles(TEST_USER)).sort()).toEqual(['Bloodborne', 'Nioh 2']); // у пользователя 1 игры нет
    expect((await get(U2)).meta.reason).toBe('not_generated'); // чужая подборка недоступна
    await run({ fetch: rawg.fetch }, U2);
    expect(await titles(U2)).toEqual(['Nioh 2']);
    await dislikeExternal(t.db, U2, { externalSource: 'rawg', externalId: '10', title: 'Nioh 2', coverUrl: null }, NOW);
    expect(await titles(U2)).toEqual([]);
    expect((await titles(TEST_USER)).sort()).toEqual(['Bloodborne', 'Nioh 2']); // дизлайк U2 не действует на U1
    const usage = await t.db.select().from(providerUsage);
    expect(new Set(usage.map((u) => u.userId))).toEqual(new Set([1, 2]));
    expect((await t.db.select().from(recommendDiscoverCache).where(eq(recommendDiscoverCache.userId, 1))).length).toBe(1);
    expect((await t.db.select().from(recommendDiscoverCache).where(and(eq(recommendDiscoverCache.userId, 2)))).length).toBe(1);
  });
});

describe('parseReasons', () => {
  const facts = [
    { id: 0, title: 'Nioh 2', genres: [], metacritic: 90, similarTo: [] },
    { id: 1, title: 'Bloodborne', genres: [], metacritic: 90, similarTo: [] },
  ];
  it('принимает валидное, отбрасывает ссылки, длину, повтор id, чужой id и чужое название', () => {
    const raw = JSON.stringify({ reasons: [
      { id: 0, text: 'Как раз то, что ты любишь.' }, { id: 1, text: 'Подойдёт, как Nioh 2.' }, { id: 5, text: 'Чужой' },
    ] });
    expect([...parseReasons(raw, facts).entries()]).toEqual([[0, 'Как раз то, что ты любишь.']]);
    expect(parseReasons(JSON.stringify([{ id: 0, text: 'a' }, { id: 0, text: 'b' }]), facts).size).toBe(0);
    expect(parseReasons('мусор', facts).size).toBe(0);
    expect(parseReasons(JSON.stringify({ reasons: [{ id: 0, text: 'zz.example.com' }] }), facts).size).toBe(0);
    expect(parseReasons('```json\n{"reasons":[{"id":1,"text":"ок"}]}\n```', facts).get(1)).toBe('ок');
  });
});
