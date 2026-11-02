// «Подскажи» на PGlite: выборки, кэш фраз, лимит LLM, дизлайки, сбои LLM не ломают ответ.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import type { LlmEnv } from '@/server/env';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { dislikeGame, getRecommendations, listDislikes, loadCandidates, loadHistory, NotFoundError, resolveReasons, undislikeGame, writeCachedReasons } from './db';
import { scoreBacklog } from './score';

const { games, gameStatus, recommendDislikes, recommendReasons, recommendLlmUsage, trophySets, gameTrophySets, trophies, allowedUsers } = schema;
const NOW = new Date('2026-10-29T09:00:00Z');
const ENV: LlmEnv = { provider: 'groq', apiKey: 'k', model: null, dailyLimit: 2 };

describe('recommend на БД', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seed() {
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
    const ins = await t.db
      .insert(games)
      .values([
        { userId: 1, ...base, titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'], hltbMainHours: 6 },
        { userId: 1, ...base, titleId: 'B', name: 'Bravo', psnGenres: ['PUZZLE'], hltbMainHours: 40, durationOverrideHours: 5 },
        { userId: 1, ...base, titleId: 'C', name: 'Charlie', psnGenres: ['ACTION'], hiddenAt: NOW },
        { userId: 1, ...base, titleId: 'D', name: 'Delta', psnGenres: ['ACTION'] },
        { userId: 1, ...base, titleId: 'S', name: 'Service', psnGenres: ['ACTION'] },
        { userId: 1, ...base, titleId: 'H1', name: 'Hist1', psnGenres: ['ACTION'], playDurationSeconds: 100 * 3600 },
        { userId: 1, ...base, titleId: 'H2', name: 'Hist2', psnGenres: ['RACING'], genresOverride: ['ACTION'], playDurationSeconds: 10 * 3600 },
      ])
      .returning({ id: games.id, titleId: games.titleId });
    const id = (k: string) => ins.find((x) => x.titleId === k)!.id;
    const old = new Date('2025-10-29T09:00:00Z');
    await t.db.insert(gameStatus).values([
      { userId: 1, gameId: id('A'), status: 'backlog', statusChangedAt: old },
      { userId: 1, gameId: id('B'), status: 'backlog', statusChangedAt: NOW },
      { userId: 1, gameId: id('C'), status: 'backlog', statusChangedAt: old },
      { userId: 1, gameId: id('D'), status: 'backlog', statusChangedAt: NOW },
      { userId: 1, gameId: id('S'), status: 'service' },
      { userId: 1, gameId: id('H1'), status: 'completed', completedAt: NOW },
      { userId: 1, gameId: id('H2'), status: 'playing' },
    ]);
    return id;
  }

  it('без LLM: кандидаты только видимый backlog, шаблоны, disabled; service и скрытые не участвуют', async () => {
    const id = await seed();
    const r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(r.meta).toEqual({ llm: 'disabled', candidates: 3, time: 'any', llmPending: 0 });
    expect(r.items.map((i) => i.game.id)).not.toContain(id('C'));
    expect(r.items.map((i) => i.game.id)).not.toContain(id('S'));
    expect(r.items.every((i) => i.reason.source === 'template')).toBe(true);
    // Alpha: жанр ACTION с историей и год в бэклоге -> первая
    expect(r.items[0].game).toMatchObject({ id: id('A'), name: 'Alpha', genres: ['ACTION'], hours: 6, hoursSource: 'hltb' });
    // ручные 5 ч приоритетнее HLTB 40
    expect(r.items.find((i) => i.game.id === id('B'))!.game).toMatchObject({ hours: 5, hoursSource: 'manual' });
    expect(r.items[0]).not.toHaveProperty('topGenre');
  });

  it('time влияет на порядок', async () => {
    const id = await seed();
    await t.db.update(games).set({ durationOverrideHours: 90 }).where(eq(games.id, id('A')));
    const long = await getRecommendations(t.db, TEST_USER, 'long', NOW, { llm: null });
    const short = await getRecommendations(t.db, TEST_USER, 'short', NOW, { llm: null });
    expect(long.items[0].game.id).toBe(id('A'));
    expect(short.items[0].game.id).not.toBe(id('A'));
  });

  it('пустой бэклог: items [], candidates 0', async () => {
    const r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(r).toEqual({ items: [], meta: { llm: 'disabled', candidates: 0, time: 'any', llmPending: 0 } });
  });

  it('трофеи: начатая игра с набором получает platinum_close; DLC вычитается из базы и не штрафует (Фаза 36)', async () => {
    const id = await seed();
    const [ts] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NP1', npServiceName: 'trophy', name: 'x', definedBronze: 8, definedGold: 2, earnedBronze: 6, earnedGold: 2 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: 1, gameId: id('D'), trophySetId: ts.id, source: 'manual' });
    let r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    const sig = (gid: number) => r.items.find((i) => i.game.id === gid)!.signals.find((s) => s.key === 'platinum_close');
    expect(sig(id('D'))?.contribution).toBe(1.2); // 8/10 * 1.5
    // 2 неполученных трофея DLC входят в defined PSN (10 = 8 база + 2 DLC): база 8/8 = 100%
    await t.db.insert(trophies).values([
      { userId: 1, trophySetId: ts.id, trophyId: 1, groupId: '001', type: 'bronze', earned: false },
      { userId: 1, trophySetId: ts.id, trophyId: 2, groupId: '001', type: 'bronze', earned: false },
    ]);
    r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(sig(id('D'))?.contribution).toBe(1.5);
      });

  it('изоляция: DLC и сеты другого пользователя не влияют на прогресс (оба считаются по своим данным)', async () => {
    const id = await seed();
    const [ts] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NP1', npServiceName: 'trophy', name: 'x', definedBronze: 8, definedGold: 2, earnedBronze: 6, earnedGold: 2 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: 1, gameId: id('D'), trophySetId: ts.id, source: 'manual' });
    // второй пользователь: тот же npCommunicationId, свой сет с 2 неполученными DLC, своя игра в бэклоге
    const [u2] = await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).returning({ id: allowedUsers.id });
    const [g2] = await t.db.insert(games).values({ userId: u2.id, category: 'ps5_native_game', lastSeenAt: NOW, titleId: 'D', name: 'Delta', psnGenres: ['ACTION'] }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId: u2.id, gameId: g2.id, status: 'backlog', statusChangedAt: NOW });
    const [ts2] = await t.db.insert(trophySets).values({ userId: u2.id, npCommunicationId: 'NP1', npServiceName: 'trophy', name: 'x', definedBronze: 8, definedGold: 2, earnedBronze: 6, earnedGold: 2 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: u2.id, gameId: g2.id, trophySetId: ts2.id, source: 'manual' });
    await t.db.insert(trophies).values([
      { userId: u2.id, trophySetId: ts2.id, trophyId: 1, groupId: '001', type: 'bronze', earned: false },
      { userId: u2.id, trophySetId: ts2.id, trophyId: 2, groupId: '001', type: 'bronze', earned: false },
    ]);
    const c1 = (await loadCandidates(t.db, TEST_USER)).find((c) => c.id === id('D'))!;
    const c2 = (await loadCandidates(t.db, u2.id as typeof TEST_USER)).find((c) => c.id === g2.id)!;
    expect(c1.trophy).toEqual({ earned: 8, total: 10, dlcTail: false });
    expect(c2.trophy).toEqual({ earned: 8, total: 8, dlcTail: false });
  });

  it('дизлайк исключает игру, снятие возвращает; идемпотентность и 404', async () => {
    const id = await seed();
    await dislikeGame(t.db, TEST_USER, id('A'));
    await dislikeGame(t.db, TEST_USER, id('A'));
    expect((await t.db.select().from(recommendDislikes)).length).toBe(1);
    let r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(r.items.map((i) => i.game.id)).not.toContain(id('A'));
    expect(r.meta.candidates).toBe(2);
    await undislikeGame(t.db, TEST_USER, id('A'));
    await undislikeGame(t.db, TEST_USER, id('A'));
    r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(r.meta.candidates).toBe(3);
    await expect(dislikeGame(t.db, TEST_USER, 9999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(undislikeGame(t.db, TEST_USER, 9999)).rejects.toBeInstanceOf(NotFoundError);
  });

  const DAY = 86_400_000;
  const dislikeAt = async (gameId: number, daysAgo: number, ms = 0) => {
    await t.db.insert(recommendDislikes).values({ userId: 1, gameId, createdAt: new Date(NOW.getTime() - daysAgo * DAY - ms) }).onConflictDoUpdate({ target: recommendDislikes.gameId, set: { createdAt: new Date(NOW.getTime() - daysAgo * DAY - ms) } });
  };

  it('TTL дизлайка: 29 и 30 суток без секунды скрывают, ровно 30 и 31 нет', async () => {
    const id = await seed();
    const has = async () => (await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null })).items.some((i) => i.game.id === id('A'));
    await dislikeAt(id('A'), 29);
    expect(await has()).toBe(false);
    await dislikeAt(id('A'), 30, -1000); // 29 сут 23:59:59
    expect(await has()).toBe(false);
    await dislikeAt(id('A'), 30);
    expect(await has()).toBe(true);
    await dislikeAt(id('A'), 31);
    expect(await has()).toBe(true);
    expect((await listDislikes(t.db, TEST_USER, NOW)).items).toEqual([]);
  });

  it('повторный POST продлевает срок (created_at обновляется), строка одна', async () => {
    const id = await seed();
    await dislikeAt(id('A'), 29);
    await dislikeGame(t.db, TEST_USER, id('A'), NOW);
    const rows = await t.db.select().from(recommendDislikes);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt.getTime()).toBe(NOW.getTime());
    const later = new Date(NOW.getTime() + 10 * DAY); // старый срок уже истёк бы
    expect((await getRecommendations(t.db, TEST_USER, 'any', later, { llm: null })).items.some((i) => i.game.id === id('A'))).toBe(false);
  });

  it('истёкший дизлайк возвращает игру в скоринг и счётчик кандидатов', async () => {
    const id = await seed();
    await dislikeAt(id('A'), 40);
    const r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(r.meta.candidates).toBe(3);
    expect(r.items.map((i) => i.game.id)).toContain(id('A'));
    await dislikeAt(id('A'), 1);
    expect((await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null })).meta.candidates).toBe(2);
  });

  it('listDislikes: пусто; только бэклог и не hidden; порядок hiddenAt desc, затем id; поля контракта', async () => {
    const id = await seed();
    expect(await listDislikes(t.db, TEST_USER, NOW)).toEqual({ items: [], ttlDays: 30 });
    await dislikeAt(id('A'), 5);
    await dislikeAt(id('B'), 1);
    await dislikeAt(id('D'), 5); // тот же момент, что у A: порядок по id
    await dislikeAt(id('C'), 2); // hidden_at
    await dislikeAt(id('H1'), 2); // completed
    await dislikeAt(id('S'), 2); // service
    const r = await listDislikes(t.db, TEST_USER, NOW);
    expect(r.items.map((i) => i.game.id)).toEqual([id('B'), Math.min(id('A'), id('D')), Math.max(id('A'), id('D'))]);
    expect(r.ttlDays).toBe(30);
    expect(r.items[0]).toEqual({
      game: { id: id('B'), name: 'Bravo', imageUrl: null, bannerUrl: null, genres: ['PUZZLE'] },
      hiddenAt: new Date(NOW.getTime() - DAY).toISOString(),
      expiresAt: new Date(NOW.getTime() + 29 * DAY).toISOString(),
    });
    expect(r.items[0]).not.toHaveProperty('topGenre');
    // игра ушла из бэклога: отметка не показывается
    await t.db.update(gameStatus).set({ status: 'playing' }).where(eq(gameStatus.gameId, id('B')));
    expect((await listDislikes(t.db, TEST_USER, NOW)).items.map((i) => i.game.id)).not.toContain(id('B'));
  });

  it('дизлайк каскадно удаляется вместе с игрой', async () => {
    const id = await seed();
    await dislikeGame(t.db, TEST_USER, id('A'));
    await t.db.delete(games).where(eq(games.id, id('A')));
    expect(await t.db.select().from(recommendDislikes)).toEqual([]);
  });

  // --- 20.4: экран не вызывает LLM, фразы читаются из кэша, который наполняет синк
  const fill = async (at: Date = NOW) => {
    // имитация шага синка: фразы всем кандидатам из скоринга time=any
    const items = scoreBacklog({
      candidates: await loadCandidates(t.db, TEST_USER), history: await loadHistory(t.db, TEST_USER), dislikedIds: new Set(), time: 'any', now: at, limit: 100,
    }).items;
    await writeCachedReasons(t.db, TEST_USER, items, new Map(items.map((i) => [i.game.id, `Фраза ${i.game.id}.`])), at);
  };

  it('экран: LLM не вызывается и счётчик не растёт; без кэша шаблон и llmPending', async () => {
    await seed();
    const r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: ENV });
    expect(r.meta).toEqual({ llm: 'ok', candidates: 3, time: 'any', llmPending: 3 });
    expect(r.items.every((i) => i.reason.source === 'template')).toBe(true);
    expect(await t.db.select().from(recommendLlmUsage)).toEqual([]);
  });

  it('кэш синка: фразы source llm, llmPending 0; фильтр времени не меняет хэш и не требует вызовов', async () => {
    const id = await seed();
    await fill();
    for (const time of ['any', 'short', 'medium', 'long'] as const) {
      const r = await getRecommendations(t.db, TEST_USER, time, NOW, { llm: ENV });
      expect(r.meta.llm).toBe('ok');
      expect(r.meta.llmPending).toBe(0);
      expect(r.items.every((i) => i.reason.source === 'llm' && i.reason.text === `Фраза ${i.game.id}.`)).toBe(true);
    }
    expect((await t.db.select().from(recommendReasons)).length).toBe(3);
    expect(id('A')).toBeGreaterThan(0);
  });

  it('срока годности нет: через 400 суток «давность» выросла, но фраза живёт', async () => {
    await seed();
    await fill();
    const later = new Date(NOW.getTime() + 400 * 86_400_000);
    const r = await getRecommendations(t.db, TEST_USER, 'any', later, { llm: ENV });
    expect(r.items.every((i) => i.reason.source === 'llm')).toBe(true);
  });

  it('смена фактов (часы игры) инвалидирует кэш только этой игры; прежняя запись заменяется', async () => {
    const id = await seed();
    await fill();
    await t.db.update(games).set({ durationOverrideHours: 50 }).where(eq(games.id, id('D')));
    const r = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: ENV });
    expect(r.meta.llmPending).toBe(1);
    expect(r.items.find((i) => i.game.id === id('D'))!.reason.source).toBe('template');
    expect(r.items.filter((i) => i.reason.source === 'llm')).toHaveLength(2);
    const items = scoreBacklog({ candidates: await loadCandidates(t.db, TEST_USER), history: await loadHistory(t.db, TEST_USER), dislikedIds: new Set(), time: 'any', now: NOW }).items;
    await writeCachedReasons(t.db, TEST_USER, items.filter((i) => i.game.id === id('D')), new Map([[id('D'), 'Новая.']]), NOW);
    expect((await t.db.select().from(recommendReasons).where(eq(recommendReasons.gameId, id('D')))).map((x) => x.text)).toEqual(['Новая.']);
  });

  it('недоступный кэш не роняет ответ: шаблоны', async () => {
    await seed();
    const items = scoreBacklog({ candidates: await loadCandidates(t.db, TEST_USER), history: await loadHistory(t.db, TEST_USER), dislikedIds: new Set(), time: 'any', now: NOW }).items;
    const db = Object.assign(Object.create(t.db), { select: () => { throw new Error('db down'); } });
    const r = await resolveReasons(db, TEST_USER, items, { llm: ENV });
    expect(r.llm).toBe('ok');
    expect(r.pending).toBe(3);
    expect([...r.reasons.values()].every((x) => x.source === 'template')).toBe(true);
  });
});
