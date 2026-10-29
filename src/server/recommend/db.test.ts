// «Подскажи» на PGlite: выборки, кэш фраз, лимит LLM, дизлайки, сбои LLM не ломают ответ.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import type { LlmEnv } from '@/server/env';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { dislikeGame, getRecommendations, NotFoundError, reserveLlmCall, undislikeGame } from './db';
import type { PhraseProvider } from './phrase';

const { games, gameStatus, recommendDislikes, recommendReasons, recommendLlmUsage, trophySets, gameTrophySets, trophies } = schema;
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
        { ...base, titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'], hltbMainHours: 6 },
        { ...base, titleId: 'B', name: 'Bravo', psnGenres: ['PUZZLE'], hltbMainHours: 40, durationOverrideHours: 5 },
        { ...base, titleId: 'C', name: 'Charlie', psnGenres: ['ACTION'], hiddenAt: NOW },
        { ...base, titleId: 'D', name: 'Delta', psnGenres: ['ACTION'] },
        { ...base, titleId: 'S', name: 'Service', psnGenres: ['ACTION'] },
        { ...base, titleId: 'H1', name: 'Hist1', psnGenres: ['ACTION'], playDurationSeconds: 100 * 3600 },
        { ...base, titleId: 'H2', name: 'Hist2', psnGenres: ['RACING'], genresOverride: ['ACTION'], playDurationSeconds: 10 * 3600 },
      ])
      .returning({ id: games.id, titleId: games.titleId });
    const id = (k: string) => ins.find((x) => x.titleId === k)!.id;
    const old = new Date('2025-10-29T09:00:00Z');
    await t.db.insert(gameStatus).values([
      { gameId: id('A'), status: 'backlog', statusChangedAt: old },
      { gameId: id('B'), status: 'backlog', statusChangedAt: NOW },
      { gameId: id('C'), status: 'backlog', statusChangedAt: old },
      { gameId: id('D'), status: 'backlog', statusChangedAt: NOW },
      { gameId: id('S'), status: 'service' },
      { gameId: id('H1'), status: 'completed', completedAt: NOW },
      { gameId: id('H2'), status: 'playing' },
    ]);
    return id;
  }

  const provider = (text: (ids: number[]) => string): PhraseProvider & { calls: number } => {
    const p = {
      name: 'groq' as const, calls: 0,
      async complete({ user }: { system: string; user: string }) {
        p.calls++;
        const ids = (JSON.parse(user) as { games: { id: number }[] }).games.map((g) => g.id);
        return text(ids);
      },
    };
    return p;
  };
  const good = (ids: number[]) => JSON.stringify({ reasons: ids.map((id) => ({ id, text: `Фраза ${id}.` })) });

  it('без LLM: кандидаты только видимый backlog, шаблоны, disabled; service и скрытые не участвуют', async () => {
    const id = await seed();
    const r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    expect(r.meta).toEqual({ llm: 'disabled', candidates: 3, time: 'any' });
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
    const long = await getRecommendations(t.db, 'long', NOW, { llm: null });
    const short = await getRecommendations(t.db, 'short', NOW, { llm: null });
    expect(long.items[0].game.id).toBe(id('A'));
    expect(short.items[0].game.id).not.toBe(id('A'));
  });

  it('пустой бэклог: items [], candidates 0', async () => {
    const r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    expect(r).toEqual({ items: [], meta: { llm: 'disabled', candidates: 0, time: 'any' } });
  });

  it('трофеи: начатая игра с набором получает platinum_close, DLC-хвост снижает', async () => {
    const id = await seed();
    const [ts] = await t.db.insert(trophySets).values({ npCommunicationId: 'NP1', npServiceName: 'trophy', name: 'x', definedBronze: 8, definedGold: 2, earnedBronze: 6, earnedGold: 2 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ gameId: id('D'), trophySetId: ts.id, source: 'manual' });
    let r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    const sig = (gid: number) => r.items.find((i) => i.game.id === gid)!.signals.find((s) => s.key === 'platinum_close');
    expect(sig(id('D'))?.contribution).toBe(1.2); // 8/10 * 1.5
    await t.db.insert(trophies).values({ trophySetId: ts.id, trophyId: 1, groupId: '001', type: 'bronze', earned: false });
    r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    expect(sig(id('D'))?.contribution).toBe(0.6);
  });

  it('дизлайк исключает игру, снятие возвращает; идемпотентность и 404', async () => {
    const id = await seed();
    await dislikeGame(t.db, id('A'));
    await dislikeGame(t.db, id('A'));
    expect((await t.db.select().from(recommendDislikes)).length).toBe(1);
    let r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    expect(r.items.map((i) => i.game.id)).not.toContain(id('A'));
    expect(r.meta.candidates).toBe(2);
    await undislikeGame(t.db, id('A'));
    await undislikeGame(t.db, id('A'));
    r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    expect(r.meta.candidates).toBe(3);
    await expect(dislikeGame(t.db, 9999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(undislikeGame(t.db, 9999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('дизлайк каскадно удаляется вместе с игрой', async () => {
    const id = await seed();
    await dislikeGame(t.db, id('A'));
    await t.db.delete(games).where(eq(games.id, id('A')));
    expect(await t.db.select().from(recommendDislikes)).toEqual([]);
  });

  it('LLM: один вызов за пачку, фразы с source llm, кэш, повторный запрос без вызова', async () => {
    await seed();
    const p = provider(good);
    const r = await getRecommendations(t.db, 'any', NOW, { llm: ENV, provider: p });
    expect(r.meta.llm).toBe('ok');
    expect(p.calls).toBe(1);
    expect(r.items.every((i) => i.reason.source === 'llm' && i.reason.text === `Фраза ${i.game.id}.`)).toBe(true);
    expect((await t.db.select().from(recommendReasons)).length).toBe(3);
    const again = await getRecommendations(t.db, 'any', NOW, { llm: ENV, provider: p });
    expect(p.calls).toBe(1);
    expect(again.meta.llm).toBe('ok');
    expect(again.items.map((i) => i.reason)).toEqual(r.items.map((i) => i.reason));
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ day: '2026-10-29', calls: 1 });
  });

  it('кэш старше 7 суток игнорируется', async () => {
    await seed();
    const p = provider(good);
    await getRecommendations(t.db, 'any', NOW, { llm: ENV, provider: p });
    await getRecommendations(t.db, 'any', new Date(NOW.getTime() + 8 * 86_400_000), { llm: { ...ENV, dailyLimit: 5 }, provider: p });
    expect(p.calls).toBe(2);
  });

  it('смена сигналов (хэш) инвалидирует кэш: вызов только для изменившихся игр', async () => {
    const id = await seed();
    const p = provider(good);
    await getRecommendations(t.db, 'any', NOW, { llm: { ...ENV, dailyLimit: 5 }, provider: p });
    await t.db.update(games).set({ durationOverrideHours: 50 }).where(eq(games.id, id('D')));
    const seen: number[][] = [];
    const p2 = provider((ids) => (seen.push(ids), good(ids)));
    const r = await getRecommendations(t.db, 'any', NOW, { llm: { ...ENV, dailyLimit: 5 }, provider: p2 });
    expect(seen).toEqual([[id('D')]]);
    expect(r.meta.llm).toBe('ok');
  });

  it('лимит: после dailyLimit вызовов meta.llm = limit и шаблоны', async () => {
    await seed();
    const p = provider(good);
    const env: LlmEnv = { ...ENV, dailyLimit: 1 };
    await getRecommendations(t.db, 'any', NOW, { llm: env, provider: p });
    await t.db.delete(recommendReasons);
    const r = await getRecommendations(t.db, 'any', NOW, { llm: env, provider: p });
    expect(p.calls).toBe(1);
    expect(r.meta.llm).toBe('limit');
    expect(r.items.every((i) => i.reason.source === 'template')).toBe(true);
    // следующие сутки МСК: снова можно
    const next = await getRecommendations(t.db, 'any', new Date(NOW.getTime() + 86_400_000), { llm: env, provider: p });
    expect(next.meta.llm).toBe('ok');
  });

  it('reserveLlmCall: суточная граница по МСК и потолок', async () => {
    expect(await reserveLlmCall(t.db, 2, new Date('2026-10-29T20:59:00Z'))).toBe(true); // 23:59 МСК 29-го
    expect(await reserveLlmCall(t.db, 2, new Date('2026-10-29T20:59:30Z'))).toBe(true);
    expect(await reserveLlmCall(t.db, 2, new Date('2026-10-29T20:59:40Z'))).toBe(false);
    expect(await reserveLlmCall(t.db, 2, new Date('2026-10-29T21:00:00Z'))).toBe(true); // 00:00 МСК 30-го
  });

  it('сбой LLM (исключение, мусор, таймаут): 200 с шаблонами и meta.llm = error; вызов учтён', async () => {
    await seed();
    const env = { ...ENV, dailyLimit: 10 };
    const broken: PhraseProvider = { name: 'groq', complete: async () => { throw new Error('boom'); } };
    const garbage = provider(() => 'не json');
    const hang: PhraseProvider = { name: 'groq', complete: (_p, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) };
    for (const [p, ms] of [[broken, undefined], [garbage, undefined], [hang, 20]] as const) {
      const r = await getRecommendations(t.db, 'any', NOW, { llm: env, provider: p, timeoutMs: ms });
      expect(r.meta.llm).toBe('error');
      expect(r.items).toHaveLength(3);
      expect(r.items.every((i) => i.reason.source === 'template')).toBe(true);
    }
    expect((await t.db.select().from(recommendLlmUsage))[0].calls).toBe(3);
    expect(await t.db.select().from(recommendReasons)).toEqual([]);
  });

  it('часть фраз невалидна: валидные = llm, остальные шаблон, невалидные не кэшируются', async () => {
    await seed();
    const p = provider((ids) => JSON.stringify({ reasons: [{ id: ids[0], text: 'Ок.' }, { id: ids[1], text: 'см. https://x.io' }] }));
    const r = await getRecommendations(t.db, 'any', NOW, { llm: ENV, provider: p });
    expect(r.meta.llm).toBe('ok');
    expect(r.items.map((i) => i.reason.source)).toEqual(['llm', 'template', 'template']);
    expect((await t.db.select().from(recommendReasons)).length).toBe(1);
  });

  it('недоступный кэш/счётчик не роняет ответ', async () => {
    await seed();
    const db = Object.assign(Object.create(t.db), { insert: () => { throw new Error('db down'); } });
    const spy = vi.fn();
    const r = await getRecommendations(db, 'any', NOW, { llm: ENV, provider: { name: 'groq', complete: spy } });
    expect(r.meta.llm).toBe('error');
    expect(spy).not.toHaveBeenCalled();
    expect(r.items).toHaveLength(3);
  });
});
