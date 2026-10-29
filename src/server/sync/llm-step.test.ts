// Шаг синка «LLM» (контракт 20.5): фразы бэклога пачками по изменившимся фактам, ночная генерация «Нового от ИИ», бюджет и пауза.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import type { LlmEnv } from '@/server/env';
import { getFailStreak, recordFailure, resetStreak } from '@/server/recommend/budget';
import { getRecommendations } from '@/server/recommend/db';
import { LlmError, type PhraseProvider } from '@/server/recommend/phrase';
import { RunContext } from './context';
import { runChunk, type SyncDeps } from './engine';
import { DISCOVER_MIN_LEFT_MS, LLM_MIN_LEFT_MS, llmStep, PHRASE_BATCH } from './llm-step';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, type TestDb } from './test-helpers';
import { connectPsn } from '@/server/psn/client';

const { games, gameStatus, recommendReasons, recommendLlmUsage, recommendDiscoverCache, syncRuns } = schema;
const NOW = new Date('2026-10-29T09:00:00Z');
const ENV: LlmEnv = { provider: 'groq', apiKey: 'gsk_STEP_SECRET', model: null, dailyLimit: 20 };

type Calls = { users: string[] };
const provider = (text: (ids: number[], n: number) => string | Error): PhraseProvider & Calls & { calls: number; opts: unknown[] } => {
  const p = {
    name: 'groq' as const, calls: 0, users: [] as string[], opts: [] as unknown[],
    async complete({ user }: { system: string; user: string }, _s: AbortSignal, opts?: unknown) {
      p.calls++; p.users.push(user); p.opts.push(opts);
      const r = text((JSON.parse(user) as { games: { id: number }[] }).games.map((g) => g.id), p.calls);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return p;
};
const good = (ids: number[]) => JSON.stringify({ reasons: ids.map((id) => ({ id, text: `Фраза ${id}.` })) });

describe('llmStep', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function ctx(budget = 1_000_000) {
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    const s = await startRun(t.db, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    return new RunContext(t.db, s.run, () => NOW, budget);
  }
  async function seed(n: number, from = 0) {
    const ins = await t.db.insert(games).values(Array.from({ length: n }, (_, i) => ({
      category: 'ps5_native_game', lastSeenAt: NOW, titleId: `L${from + i}`, name: `Игра ${from + i} ${'абвгд'[(from + i) % 5]}ж`, psnGenres: ['ACTION'], hltbMainHours: 10 + i,
    }))).returning({ id: games.id });
    await t.db.insert(gameStatus).values(ins.map((g) => ({ gameId: g.id, status: 'backlog' as const, statusChangedAt: NOW })));
    return ins.map((g) => g.id);
  }
  const cached = async () => (await t.db.select().from(recommendReasons)).length;

  it('без LLM шаг ничего не делает', async () => {
    await seed(3);
    const p = provider(good);
    const r = await llmStep(await ctx(), { env: null, provider: p });
    expect(r).toEqual({ phrasesGenerated: 0, phrasesFailed: 0, discover: 'skipped' });
    expect(p.calls).toBe(0);
  });

  it('64 игры = 4 вызова по 16; тексты в кэше; max_tokens 3000; экран потом не зовёт LLM', async () => {
    await seed(64);
    const p = provider(good);
    const c = await ctx();
    const r = await llmStep(c, { env: ENV, provider: p, rawgKey: null });
    expect(PHRASE_BATCH).toBe(16);
    expect(p.calls).toBe(4);
    expect(p.users.map((u) => (JSON.parse(u) as { games: unknown[] }).games.length)).toEqual([16, 16, 16, 16]);
    expect(p.opts[0]).toEqual({ maxTokens: 3000 });
    expect(r.phrasesGenerated).toBe(64);
    expect(await cached()).toBe(64);
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ calls: 4, phraseCalls: 4 });
    // экран: фразы из кэша, счётчик не растёт
    const screen = await getRecommendations(t.db, 'short', NOW, { llm: ENV });
    expect(screen.items.every((i) => i.reason.source === 'llm')).toBe(true);
    expect(screen.meta.llmPending).toBe(0);
    expect((await t.db.select().from(recommendLlmUsage))[0].calls).toBe(4);
  });

  it('N-6: ошибка записи кэша в БД не возвращает вызов и не копит неудачи провайдера; пауза не пишет llm_discover_failed', async () => {
    await seed(5);
    const p = provider((ids) => {
      void ids;
      return good(ids);
    });
    const orig = p.complete.bind(p);
    p.complete = async (...a: Parameters<typeof orig>) => {
      const r = await orig(...a);
      await t.db.execute(sql`alter table recommend_reasons rename to recommend_reasons_x`);
      return r;
    };
    const c = await ctx();
    try {
      const r = await llmStep(c, { env: ENV, provider: p, rawgKey: null });
      expect(r.phrasesFailed).toBe(1);
    } finally {
      await t.db.execute(sql`alter table recommend_reasons_x rename to recommend_reasons`);
    }
    expect((await getFailStreak(t.db)).streak).toBe(0);
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ calls: 1, phraseCalls: 1 }); // вызов потрачен
  });

  it('N-6: при паузе генерация «Нового от ИИ» не пробуется и предупреждения нет', async () => {
    await seed(1);
    const c = await ctx();
    const ok = provider(good);
    await llmStep(c, { env: ENV, provider: ok, rawgKey: 'rawg_K' }); // обнулит streak
    await t.db.delete(recommendDiscoverCache);
    const bad = provider(() => new LlmError('http', 'http_500'));
    await t.db.delete(recommendReasons);
    // три неудачи фраз подряд = пауза; seed(64) даёт 4 пачки
    await seed(63, 100);
    const c2 = await ctx();
    const warn = vi.spyOn(c2, 'warn');
    const r = await llmStep(c2, { env: ENV, provider: bad, rawgKey: 'rawg_K' });
    expect(r.discover).toBe('skipped');
    expect(warn.mock.calls.map((x) => x[0])).not.toContain('llm_discover_failed');
  });

  it('повторный синк без изменений: 0 вызовов; изменился один факт: один вызов на одну игру', async () => {
    const ids = await seed(20);
    await llmStep(await ctx(), { env: ENV, provider: provider(good), rawgKey: null });
    const again = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: again, rawgKey: null });
    expect(again.calls).toBe(0);
    await t.db.update(games).set({ durationOverrideHours: 77 }).where(eq(games.id, ids[3]));
    const one = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: one, rawgKey: null });
    expect(one.calls).toBe(1);
    expect((JSON.parse(one.users[0]) as { games: { id: number }[] }).games.map((g) => g.id)).toEqual([ids[3]]);
    expect(await cached()).toBe(20); // старая запись игры заменена, а не добавлена
  });

  it('фразы не зависят от «давности»: через полгода кэш прежний, вызовов нет', async () => {
    await seed(5);
    await llmStep(await ctx(), { env: ENV, provider: provider(good), rawgKey: null });
    const later = provider(good);
    const s = await t.db.insert(syncRuns).values({ kind: 'manual', status: 'success', snapshotDate: '2027-04-29' }).returning();
    const c = new RunContext(t.db, s[0], () => new Date('2027-04-29T09:00:00Z'), 1_000_000);
    await llmStep(c, { env: ENV, provider: later, rawgKey: null });
    expect(later.calls).toBe(0);
  });

  it('неудача: вызов возвращён в бюджет, игры без кэша, предупреждение; 3 подряд = стоп до следующего синка', async () => {
    await seed(64);
    const bad = provider(() => new LlmError('http', 'http_500'));
    const c = await ctx();
    const r = await llmStep(c, { env: ENV, provider: bad, rawgKey: null });
    expect(bad.calls).toBe(3); // 4-ю пачку не начинаем: пауза
    expect(r.phrasesFailed).toBe(3);
    expect(await cached()).toBe(0);
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ calls: 0, phraseCalls: 0 });
    expect(c.warnings.map((w) => w.code)).toContain('llm_phrases_failed');
    expect(c.warnings.find((w) => w.code === 'llm_phrases_failed')!.message).toContain('http_500');
    expect((await getFailStreak(t.db)).streak).toBe(3);
    // следующий синк сбрасывает паузу и пробует снова
    const ok = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: ok, rawgKey: null });
    expect(ok.calls).toBe(4);
    expect(await cached()).toBe(64);
    expect((await getFailStreak(t.db)).streak).toBe(0);
  });

  it('обрезанный ответ (truncated) = неудача, причина в предупреждении', async () => {
    await seed(3);
    const c = await ctx();
    await llmStep(c, { env: ENV, provider: provider(() => new LlmError('bad_response', 'truncated')), rawgKey: null });
    expect(c.warnings[0].message).toContain('truncated');
  });

  it('частично валидный ответ: валидные в кэше, остальные повторятся', async () => {
    const ids = await seed(4);
    const p = provider((got) => JSON.stringify({ reasons: got.map((id, k) => ({ id, text: k < 2 ? 'см. https://evil.example' : `Фраза ${id}.` })) }));
    await llmStep(await ctx(), { env: ENV, provider: p, rawgKey: null });
    expect(await cached()).toBe(2);
    const p2 = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: p2, rawgKey: null });
    expect(p2.calls).toBe(1);
    expect((JSON.parse(p2.users[0]) as { games: unknown[] }).games).toHaveLength(2);
    expect(ids.length).toBe(4);
  });

  it('потолок фраз в сутки (8 вызовов) и общий предохранитель', async () => {
    await seed(200);
    const p = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: p, rawgKey: null });
    expect(p.calls).toBe(8);
    const p2 = provider(good);
    await llmStep(await ctx(), { env: { ...ENV, dailyLimit: 1 }, provider: p2, rawgKey: null });
    expect(p2.calls).toBe(0); // сегодня 8 уже занято
  });

  it('мало времени: пачка не начинается', async () => {
    await seed(4);
    const p = provider(good);
    await llmStep(await ctx(LLM_MIN_LEFT_MS - 1), { env: ENV, provider: p, rawgKey: null });
    expect(p.calls).toBe(0);
  });

  it('дизлайкнутые игры не получают фраз', async () => {
    const ids = await seed(3);
    await t.db.insert(schema.recommendDislikes).values({ gameId: ids[0], createdAt: NOW });
    const p = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: p, rawgKey: null });
    expect((JSON.parse(p.users[0]) as { games: { id: number }[] }).games.map((g) => g.id).sort()).toEqual([ids[1], ids[2]].sort());
  });

  it('ключ не попадает в предупреждения, кэш и консоль', async () => {
    await seed(3);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const c = await ctx();
    await llmStep(c, { env: ENV, provider: provider(() => new Error('upstream gsk_STEP_SECRET denied')), rawgKey: null });
    expect(JSON.stringify([c.warnings, await t.db.select().from(recommendReasons), await t.db.select().from(recommendLlmUsage)])).not.toContain('gsk_STEP_SECRET');
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('gsk_STEP_SECRET');
    vi.restoreAllMocks();
  });

  // --- «Новое от ИИ»
  const rawg = { key: 'rawg_KEY' };
  const discoverFetch = (proposals: string[]) => {
    const st = { groq: 0 };
    const f = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'api.groq.com') {
        st.groq++;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ games: proposals.map((title) => ({ title, year: 2020, reason: `Причина ${title}.` })) }) } }] }), { status: 200 });
      }
      const q = url.searchParams.get('search') ?? '';
      return new Response(JSON.stringify({ results: [{ id: q.length, name: q, released: '2020-01-01', platforms: [{ platform: { name: 'PlayStation 5', slug: 'playstation5' } }] }] }), { status: 200 });
    }) as typeof fetch;
    return Object.assign(f, { st });
  };

  it('«Новое от ИИ»: одна генерация в сутки в синке; повторный синк использует кэш', async () => {
    const f = discoverFetch(['Hades', 'Stray']);
    const c1 = await ctx();
    const r1 = await llmStep(c1, { env: ENV, provider: provider(good), rawgKey: rawg.key, discover: { fetch: f } });
    expect(r1.discover).toBe('generated');
    expect(f.st.groq).toBe(1);
    expect((await t.db.select().from(recommendDiscoverCache)).map((r) => r.day)).toEqual(['2026-10-29']);
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ discoverAutoCalls: 1, discoverManualCalls: 0 });
    const r2 = await llmStep(await ctx(), { env: ENV, provider: provider(good), rawgKey: rawg.key, discover: { fetch: f } });
    expect(r2.discover).toBe('cached');
    expect(f.st.groq).toBe(1);
  });

  it('«Новое от ИИ»: без RAWG, не Groq или мало времени генерации нет; сбой = предупреждение, вызов возвращён', async () => {
    const f = discoverFetch(['Hades']);
    expect((await llmStep(await ctx(), { env: ENV, provider: provider(good), rawgKey: null, discover: { fetch: f } })).discover).toBe('skipped');
    expect((await llmStep(await ctx(), { env: { ...ENV, provider: 'gemini' }, provider: provider(good), rawgKey: 'k', discover: { fetch: f } })).discover).toBe('skipped');
    expect((await llmStep(await ctx(DISCOVER_MIN_LEFT_MS - 1), { env: ENV, provider: provider(good), rawgKey: 'k', discover: { fetch: f } })).discover).toBe('skipped');
    expect(f.st.groq).toBe(0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    const c = await ctx();
    const r = await llmStep(c, { env: ENV, provider: provider(good), rawgKey: 'k', discover: { fetch: broken } });
    expect(r.discover).toBe('failed');
    expect(c.warnings.map((w) => w.code)).toContain('llm_discover_failed');
    expect((await t.db.select().from(recommendLlmUsage))[0]).toMatchObject({ discoverAutoCalls: 0 });
    vi.restoreAllMocks();
  });

  it('сброс паузы в начале шага: накопленные неудачи не блокируют синк', async () => {
    await seed(2);
    for (let i = 0; i < 3; i++) await recordFailure(t.db, 'http_500', NOW);
    const p = provider(good);
    await llmStep(await ctx(), { env: ENV, provider: p, rawgKey: null });
    expect(p.calls).toBe(1);
    await resetStreak(t.db, NOW);
  });
});

describe('шаг LLM в runChunk', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const mk = (llm?: SyncDeps['llm']): SyncDeps => ({
    db: t.db, now: () => NOW, budgetMs: 1_000_000, llm,
    connect: () => connectPsn({ getAccessToken: async () => 'tok', onlineId: 'x', delayMs: 0, api: fakeApi(freshState()), sleep: async () => undefined }),
  });
  async function run(llm?: SyncDeps['llm']) {
    const s = await startRun(t.db, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    const res = await runChunk(mk(llm), s.run);
    const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, s.run.id));
    return { res, row };
  }
  async function backlogGame() {
    const [g] = await t.db.insert(games).values({ category: 'ps5_native_game', lastSeenAt: NOW, titleId: 'BL1', name: 'Бэклог Игра', psnGenres: ['ACTION'] }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ gameId: g.id, status: 'backlog', statusChangedAt: NOW });
    return g.id;
  }

  it('без deps.llm шаг отключён: синк success, кэша нет', async () => {
    await backlogGame();
    const { res } = await run(undefined);
    expect(res.status).toBe('success');
    expect(await t.db.select().from(recommendReasons)).toEqual([]);
  });

  it('с deps.llm фразы создаются в конце успешного звена', async () => {
    await backlogGame();
    const { res } = await run({ env: ENV, provider: provider(good), rawgKey: null });
    expect(res.status).toBe('success');
    expect(await t.db.select().from(recommendReasons)).toHaveLength(1);
  });

  it('сбой провайдера не меняет итог синка: success и предупреждение', async () => {
    await backlogGame();
    const { res, row } = await run({ env: ENV, provider: provider(() => new LlmError('timeout')), rawgKey: null });
    expect(res.status).toBe('success');
    expect(JSON.stringify(row.warnings)).toContain('llm_phrases_failed');
  });

  it('исключение шага (например, недоступная БД кэша) = llm_failed, итог success', async () => {
    const llm: SyncDeps['llm'] = {
      get env(): LlmEnv {
        throw new Error('boom');
      },
    };
    const { res, row } = await run(llm);
    expect(res.status).toBe('success');
    expect(JSON.stringify(row.warnings)).toContain('llm_failed');
  });
});
