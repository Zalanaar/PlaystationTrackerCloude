// QA Фазы 30 (независимые проверки): совпадение названий с библиотекой, форма реального ответа RAWG, идемпотентность и лимиты.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { parseDiscoverPage } from '@/server/catalog/rawg';
import { getDiscover, refreshDiscover, type DiscoverDeps } from './discover';
import { inLibrary, buildLibraryIndex } from './discover-rank';

const { games, gameStatus, providerUsage, recommendDiscoverCache, recommendLlmUsage } = schema;
const NOW = new Date('2026-10-31T09:00:00Z');
const KEY = 'rawg_QA_SECRET';
const LIMITS = { userLimit: 60, totalLimit: 300 };

// Форма записи по документации RAWG (GET /api/games): id, slug, name, released, tba, background_image, rating, ratings_count, metacritic,
// platforms[{platform{id,name,slug},released_at,requirements_*}], genres[{id,name,slug,...}], tags[...], short_screenshots, esrb_rating.
const real = (o: Record<string, unknown> = {}) => ({
  id: 3498, slug: 'grand-theft-auto-v', name: 'Grand Theft Auto V', released: '2013-09-17', tba: false,
  background_image: 'https://media.rawg.io/media/games/20a/20aa03a10cda45239fe22d035c0ebe64.jpg', rating: 4.47, rating_top: 5, ratings: [], ratings_count: 6000,
  reviews_text_count: 60, added: 20000, added_by_status: { yet: 1 }, metacritic: 92, playtime: 74, suggestions_count: 400, updated: '2026-10-01T10:00:00',
  user_game: null, reviews_count: 6100, saturated_color: '0f0f0f', dominant_color: '0f0f0f',
  platforms: [{ platform: { id: 4, name: 'PC', slug: 'pc' }, released_at: '2013-09-17', requirements_en: null, requirements_ru: null }, { platform: { id: 18, name: 'PlayStation 4', slug: 'playstation4' }, released_at: '2013-09-17', requirements_en: null, requirements_ru: null }],
  parent_platforms: [{ platform: { id: 1, name: 'PC', slug: 'pc' } }],
  genres: [{ id: 4, name: 'Action', slug: 'action', games_count: 1, image_background: 'https://x/y.jpg' }],
  stores: [{ store: { id: 1, name: 'Steam', slug: 'steam' } }], clip: null,
  tags: [{ id: 31, name: 'Singleplayer', slug: 'singleplayer', language: 'eng', games_count: 1, image_background: 'https://x/y.jpg' }],
  esrb_rating: { id: 4, name: 'Mature', slug: 'mature' }, short_screenshots: [{ id: -1, image: 'https://x/z.jpg' }], ...o,
});

describe('QA Ф30: форма ответа RAWG', () => {
  it('реальная форма разбирается: PS4, жанр, метакритик, рейтинг, slug, hasMore по next', () => {
    const p = parseDiscoverPage({ count: 900, next: 'https://api.rawg.io/api/games?page=2&key=SECRET', previous: null, results: [real()], user_platforms: false });
    expect(p.hasMore).toBe(true);
    expect(p.results[0]).toMatchObject({ externalId: '3498', slug: 'grand-theft-auto-v', psPlatforms: ['PS4'], genreSlugs: ['action'], metacritic: 92, rating: 4.5, releaseDate: '2013-09-17' });
    expect(JSON.stringify(p)).not.toContain('SECRET');
  });
  // QA-30-1: битая дата -> releaseDate null, остальные игры страницы разбираются
  it('граничные значения: null-поля, rating 0, пустые массивы, tba, дата мусор', () => {
    const p = parseDiscoverPage({ next: null, results: [real({ id: 1, rating: 0, metacritic: null, genres: [], tags: null, platforms: [] }), real({ id: 2, released: null }), real({ id: 3, tba: true }), real({ id: 4, released: '2020-13-45' }), real({ id: 5, name: '   ' })] });
    expect(p.hasMore).toBe(false);
    expect(p.results.map((r) => r.externalId)).toEqual(['1', '2', '3', '4']);
    expect(p.results[0]).toMatchObject({ rating: null, metacritic: null, psPlatforms: [] });
    expect(p.results[3].releaseDate).toBeNull();
  });
  it('форма не та: ошибка страницы, а не пустая выдача', () => {
    expect(() => parseDiscoverPage({ detail: 'Invalid API key' })).toThrow();
    expect(() => parseDiscoverPage(null)).toThrow();
    expect(() => parseDiscoverPage([])).toThrow();
  });
});

describe('QA Ф30: названия библиотеки', () => {
  const lib = (...n: string[]) => buildLibraryIndex(n);
  it.each([
    ['God of War', 'God of War™'],
    ['Marvel\'s Spider-Man: Miles Morales', 'Marvel’s Spider-Man: Miles Morales (PS5)'],
    ['The Last of Us Part I', 'The Last of Us™ Part I'],
    ['Horizon Zero Dawn', 'Horizon Zero Dawn™ Complete Edition'],
    ['Cyberpunk 2077', 'Cyberpunk 2077 Ultimate Edition PS5'],
    ['Persona 5 Royal', 'PERSONA 5 ROYAL'],
    ['Dark Souls III', 'DARK SOULS™ III'],
  ])('RAWG «%s» уже в библиотеке как «%s»', (rawgTitle, own) => {
    expect(inLibrary(rawgTitle, lib(own))).toBe(true);
  });
  it.each([
    ['Hades II', 'Hades'],
    ['Resident Evil 2', 'Resident Evil 4'],
    ['Dark Souls II', 'Dark Souls III'],
    ['God of War Ragnarök', 'God of War'],
    ['Persona 4 Golden', 'Persona 5 Royal'],
  ])('«%s» не совпадает с «%s» (нет ложного исключения)', (rawgTitle, own) => {
    expect(inLibrary(rawgTitle, lib(own))).toBe(false);
  });
});

describe('QA Ф30 (QA-30-2): издания и суффиксы одной игры', () => {
  it.each([
    ['Final Fantasy VII Remake', 'FINAL FANTASY VII REMAKE INTERGRADE'],
    ['Resident Evil 4', 'Resident Evil 4 Remake'],
    ['Dark Souls 3', 'DARK SOULS™ III'],
    ['Dark Souls III', 'Dark Souls 3 Deluxe Edition'],
    ['Alan Wake 2', 'Alan Wake II Digital Deluxe Edition'],
    ['Death Stranding', "Death Stranding Director's Cut"],
  ])('RAWG «%s» уже в библиотеке как «%s»', (rawgTitle, own) => {
    expect(inLibrary(rawgTitle, buildLibraryIndex([own]))).toBe(true);
  });
  it.each([
    ['Final Fantasy VII Remake', 'Final Fantasy VII'],
    ['Resident Evil 4 Remake', 'Resident Evil 4'],
    ['Final Fantasy VII', 'FINAL FANTASY VII REMAKE INTERGRADE'.replace('VII', 'VIII')],
    ['Hades II', 'Hades'],
    ['Resident Evil 4', 'Resident Evil 2 Remake'],
    ['Alan Wake 2', 'Alan Wake Remastered'],
    ['Dark Souls II', 'Dark Souls III Deluxe Edition'],
  ])('«%s» остаётся отдельной игрой при «%s»', (rawgTitle, own) => {
    expect(inLibrary(rawgTitle, buildLibraryIndex([own]))).toBe(false);
  });
  it('русское название PSN не совпадёт с английским RAWG (спасает только hltb_name)', () => {
    expect(inLibrary('The Witcher 3: Wild Hunt', buildLibraryIndex(['Ведьмак 3: Дикая Охота']))).toBe(false);
  });
});

describe('QA Ф30: идемпотентность, лимиты, изоляция (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const addGame = async (userId: number, name: string, status: 'completed' | null = 'completed') => {
    const [g] = await t.db.insert(games).values({ userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `T${userId}${name}`, name, psnGenres: ['ACTION'], playDurationSeconds: 40 * 3600 }).returning({ id: games.id });
    if (status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status, statusChangedAt: NOW });
  };
  const mk = (n: number) => Array.from({ length: n }, (_, i) => real({ id: 1000 + i, slug: `g-${i}`, name: `Game ${i}`, metacritic: 90 - (i % 10) }));
  const counted = (list: unknown[]) => {
    const urls: URL[] = [];
    const fetchFn = (async (input: URL | string) => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify({ next: 'https://api.rawg.io/api/games?page=2', results: list }), { status: 200 });
    }) as typeof fetch;
    return { fetchFn, urls };
  };
  const run = (deps: DiscoverDeps, uid = TEST_USER) => refreshDiscover(t.db, uid, NOW, { rawgKey: KEY, limits: LIMITS, llm: null, ...deps });

  it('не больше 8 запросов за запуск даже при next на каждой странице; повтор в те же сутки = 0 запросов', async () => {
    await addGame(1, 'Alpha');
    const r = counted(mk(3)); // мало выживших -> добор страниц
    const a = await run({ fetch: r.fetchFn });
    expect(a.requests).toBeLessThanOrEqual(8);
    const n = r.urls.length;
    expect(n).toBeLessThanOrEqual(8);
    const b = await run({ fetch: r.fetchFn });
    expect(r.urls.length).toBe(n + (b.status === 'skipped' ? 0 : b.requests));
    const usage = await t.db.select().from(providerUsage);
    expect(usage.reduce((s, u) => s + u.calls, 0)).toBe(r.urls.length);
  });

  it('лимит RAWG на пользователя: после исчерпания запросов нет, шаг не падает', async () => {
    await addGame(1, 'Alpha');
    const r = counted(mk(30));
    const a = await run({ fetch: r.fetchFn, limits: { userLimit: 1, totalLimit: 300 } });
    expect(r.urls.length).toBe(1);
    expect(['limit', 'partial']).toContain(a.status);
    const b = await run({ fetch: r.fetchFn, limits: { userLimit: 1, totalLimit: 300 } });
    expect(r.urls.length).toBe(1);
    expect(b.status).toBe('limit');
  });

  it('изоляция: подборка и ключ RAWG не утекают между пользователями и в ответ', async () => {
    await addGame(1, 'Alpha');
    await addGame(2, 'Beta');
    const r = counted([real({ id: 7, name: 'Only Game' })]);
    await run({ fetch: r.fetchFn }, TEST_USER);
    const u1 = await getDiscover(t.db, TEST_USER, NOW, { rawgKey: KEY, limits: LIMITS });
    const u2 = await getDiscover(t.db, (await import('@/server/auth/user-id')).asUserId(2), NOW, { rawgKey: KEY, limits: LIMITS });
    expect(u1.items.length).toBe(1);
    expect(u2.items).toHaveLength(0);
    expect(u2.meta.reason).toBe('not_generated');
    expect(JSON.stringify([u1, await t.db.select().from(recommendDiscoverCache)])).not.toContain(KEY);
    expect(await t.db.select().from(providerUsage).where(eq(providerUsage.userId, 2))).toHaveLength(0);
    expect(await t.db.select().from(recommendLlmUsage)).toHaveLength(0);
  });

  it('игра, добавленная в библиотеку после подборки, исчезает из выдачи сразу', async () => {
    await addGame(1, 'Alpha');
    const r = counted([real({ id: 7, name: 'Only Game' })]);
    await run({ fetch: r.fetchFn });
    expect((await getDiscover(t.db, TEST_USER, NOW, { rawgKey: KEY, limits: LIMITS })).items).toHaveLength(1);
    await addGame(1, 'Only Game', null);
    const d = await getDiscover(t.db, TEST_USER, NOW, { rawgKey: KEY, limits: LIMITS });
    expect(d.items).toHaveLength(0);
    expect(d.meta.reason).toBe('no_candidates');
  });

  it('подборка «вчерашняя»: stale=true; сеть не вызывается из GET', async () => {
    await addGame(1, 'Alpha');
    const r = counted([real({ id: 7, name: 'Only Game' })]);
    await run({ fetch: r.fetchFn });
    const n = r.urls.length;
    const d = await getDiscover(t.db, TEST_USER, new Date('2026-11-01T09:00:00Z'), { rawgKey: KEY, limits: LIMITS });
    expect(d.meta.stale).toBe(true);
    expect(d.items).toHaveLength(1);
    expect(r.urls.length).toBe(n);
  });
});
