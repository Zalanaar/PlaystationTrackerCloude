// QA Фазы 13 (повторная приёмка, контракт 18.9): 9 карточек, пачка LLM на 9 игр, TTL скрытия, GET /dislikes, LINK_RE.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { DISLIKE_TTL_DAYS, DISLIKE_TTL_MS, dislikeExpiresAt, isDislikeActive } from '@/shared/recommend';
import { DEFAULT_TTL_DAYS } from '@/ui/recommend/model';
import { dislikeGame, getDislikedIds, getRecommendations, listDislikes, undislikeGame } from './db';
import { geminiProvider, groqProvider, isValidPhrase, LLM_MAX_OUTPUT_TOKENS } from './phrase';
import { TOP_N } from './score';

const { games, gameStatus, recommendDislikes } = schema;
const NOW = new Date('2026-10-29T09:00:00Z');
const DAY = 86_400_000;

describe('QA 13b: общие константы и граница TTL', () => {
  it('30 суток, UI и сервер используют один источник', () => {
    expect(DISLIKE_TTL_DAYS).toBe(30);
    expect(DEFAULT_TTL_DAYS).toBe(DISLIKE_TTL_DAYS);
    expect(DISLIKE_TTL_MS).toBe(30 * DAY);
  });
  it('граница: ровно 30 суток = уже не действует; без 1 мс действует', () => {
    const c = new Date(NOW.getTime() - DISLIKE_TTL_MS);
    expect(isDislikeActive(c, NOW)).toBe(false);
    expect(isDislikeActive(new Date(c.getTime() + 1), NOW)).toBe(true);
    expect(dislikeExpiresAt(NOW).getTime() - NOW.getTime()).toBe(30 * DAY);
  });
});

describe('QA 13b: БД', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seedBacklog(n: number, base = 'G') {
    const ins = await t.db.insert(games).values(Array.from({ length: n }, (_, i) => ({
      category: 'ps5_native_game', lastSeenAt: NOW, titleId: `${base}${i}`, name: `Игра ${String.fromCharCode(65 + i)}${i}`, psnGenres: ['ACTION'], hltbMainHours: 10,
    }))).returning({ id: games.id });
    await t.db.insert(gameStatus).values(ins.map((g) => ({ gameId: g.id, status: 'backlog' as const, statusChangedAt: new Date(NOW.getTime() - 100 * DAY) })));
    return ins.map((g) => g.id);
  }
  it('TOP_N = 9: из 12 кандидатов 9 карточек, candidates 12; из 5 — 5', async () => {
    await seedBacklog(12);
    const r = await getRecommendations(t.db, 'any', NOW, { llm: null });
    expect(TOP_N).toBe(9);
    expect(r.items).toHaveLength(9);
    expect(r.meta.candidates).toBe(12);
    await t.reset();
    await seedBacklog(5);
    expect((await getRecommendations(t.db, 'any', NOW, { llm: null })).items).toHaveLength(5);
  });

  it('лимит токенов 2000 уходит в тело запроса Gemini и Groq', async () => {
    expect(LLM_MAX_OUTPUT_TOKENS).toBe(2000);
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: unknown, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const sig = new AbortController().signal;
    await geminiProvider({ provider: 'gemini', apiKey: 'k', model: 'm' }, f).complete({ system: 's', user: 'u' }, sig).catch(() => undefined);
    await groqProvider({ provider: 'groq', apiKey: 'k', model: 'm' }, f).complete({ system: 's', user: 'u' }, sig).catch(() => undefined);
    expect((bodies[0].generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(2000);
    expect(bodies[1].max_tokens).toBe(2000);
  });

  it('TTL: 29 суток 23:59 скрыта, ровно 30 суток вернулась, в скоринге и в списке одинаково', async () => {
    const [id] = await seedBacklog(1);
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    for (const [age, hidden] of [[30 * DAY - 60_000, true], [30 * DAY - 1, true], [30 * DAY, false], [30 * DAY + 1, false], [0, true]] as const) {
      await t.db.delete(recommendDislikes);
      await t.db.insert(recommendDislikes).values({ gameId: id, createdAt: at(age) });
      expect((await getDislikedIds(t.db, NOW)).has(id), `age ${age}`).toBe(hidden);
      expect((await listDislikes(t.db, NOW)).items.length, `list ${age}`).toBe(hidden ? 1 : 0);
      expect((await getRecommendations(t.db, 'any', NOW, { llm: null })).items.length, `rec ${age}`).toBe(hidden ? 0 : 1);
    }
  });

  it('повторный POST продлевает срок (created_at = now), одна строка; DELETE возвращает и идемпотентен', async () => {
    const [id] = await seedBacklog(1);
    await dislikeGame(t.db, id, new Date(NOW.getTime() - 25 * DAY));
    await dislikeGame(t.db, id, NOW);
    const rows = await t.db.select().from(recommendDislikes);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt.getTime()).toBe(NOW.getTime());
    // истёкшую отметку POST оживляет заново на 30 суток
    await t.db.update(recommendDislikes).set({ createdAt: new Date(NOW.getTime() - 40 * DAY) });
    expect((await listDislikes(t.db, NOW)).items).toHaveLength(0);
    await dislikeGame(t.db, id, NOW);
    const l = await listDislikes(t.db, NOW);
    expect(l.items[0].expiresAt).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    await undislikeGame(t.db, id);
    await undislikeGame(t.db, id);
    expect((await listDislikes(t.db, NOW)).items).toEqual([]);
    expect((await getRecommendations(t.db, 'any', NOW, { llm: null })).items).toHaveLength(1);
  });

  it('GET /dislikes: только бэклог, не hidden_at, не истёкшие; порядок hiddenAt desc, затем id', async () => {
    const ids = await seedBacklog(6);
    const [done, hid] = [ids[4], ids[5]];
    await t.db.update(gameStatus).set({ status: 'completed' }).where(eq(gameStatus.gameId, done));
    await t.db.update(games).set({ hiddenAt: NOW }).where(eq(games.id, hid));
    const same = new Date(NOW.getTime() - 2 * DAY);
    await t.db.insert(recommendDislikes).values([
      { gameId: ids[2], createdAt: same }, { gameId: ids[0], createdAt: same }, { gameId: ids[1], createdAt: NOW },
      { gameId: ids[3], createdAt: new Date(NOW.getTime() - 31 * DAY) }, { gameId: done, createdAt: NOW }, { gameId: hid, createdAt: NOW },
    ]);
    const r = await listDislikes(t.db, NOW);
    expect(r.ttlDays).toBe(30);
    expect(r.items.map((i) => i.game.id)).toEqual([ids[1], Math.min(ids[0], ids[2]), Math.max(ids[0], ids[2])]);
    expect(r.items[0]).toMatchObject({ hiddenAt: NOW.toISOString(), game: { genres: ['ACTION'] } });
    // возврат в бэклог игры с неистёкшей отметкой: снова скрыта (TTL, без воскрешения вечной)
    await t.db.update(gameStatus).set({ status: 'backlog' }).where(eq(gameStatus.gameId, done));
    expect((await listDislikes(t.db, NOW)).items.map((i) => i.game.id)).toContain(done);
  });
});

describe('QA 13b: GET /api/recommend/dislikes без БД', () => {
  it('503 db_unavailable без текста исходной ошибки', async () => {
    vi.resetModules();
    vi.doMock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => { throw new Error('postgres://u:SECRETPASS@h/db'); } }));
    const { GET } = await import('@/app/api/recommend/dislikes/route');
    const r = await GET();
    expect(r.status).toBe(503);
    const text = await r.text();
    expect(text).toContain('db_unavailable');
    expect(text).not.toContain('SECRETPASS');
    vi.doUnmock('@/db');
  });
});

describe('QA 13b: N-2, LINK_RE на реальных названиях и русском тексте', () => {
  const ok = [
    'Отличная игра: «God of War: Ragnarök» продолжает историю.',
    'Spider-Man 2 ждёт в бэклоге уже давно.',
    'Dr. Mario отлично подходит на вечер.',
    'Жанр «Экшен» тебе заходит, на прохождение уйдёт около 22 часов.',
    'Версия 1.5 и патч v1.2 уже вышли. Пора играть.',
    'Конец.', 'Ep.2 сильнее первой части.', 'Persona 5 Royal. Классика JRPG.', 'Платина близко... осталось немного!',
    'Игра на 8–30 ч; самое то. Ёмко, коротко.', 'Cyberpunk 2077 и NBA 2K24 в списке.', 'Marvel vs. Capcom: коротко и ярко.',
    '.hack//G.U. Last Recode: классика.', 'Игра ждёт 12.5 месяцев.',
  ];
  for (const s of ok) it(`проходит: ${s}`, () => expect(isValidPhrase(s)).toBe(true));
  const bad = ['bit.ly/abc', 'goo.gl/x', 'evil.co/a', 'evil.to', 'evil.cc', 'Смотри www.evil.com', 'https://a.b', '[x](y)', '<b>x</b>', 'example.com'];
  for (const s of bad) it(`отклоняется: ${s}`, () => expect(isValidPhrase(s)).toBe(false));
  // Известное ложное срабатывание (безвредно, фраза уходит в шаблон): латинское слово + точка без пробела.
  it('Mr.Bean / Dr.Mario без пробела отбрасываются (шаблон), фиксируем поведение', () => {
    expect(isValidPhrase('Mr.Bean ждёт тебя.')).toBe(false);
    expect(isValidPhrase('Dr.Mario ждёт тебя.')).toBe(false);
    expect(isValidPhrase('Отлично.Сыграй сегодня')).toBe(true);
  });
});
