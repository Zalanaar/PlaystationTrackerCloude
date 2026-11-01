// Сводка на PGlite (контракт Фазы 29): данные блоков, границы недели, идемпотентность, изоляция пользователей, получатели, сбои.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { collectDigest, collectHours, collectTrophies, defaultCollectors } from './data';
import { runDigest, runDigestForUser } from './run';
import { weekByMonday } from './week';

const { games, trophies, trophySets, gameTrophySets, playtimeSnapshots, notifyLog, telegramChats, digestState } = schema;
const A = TEST_USER;
const B = TEST_USER_2;
const WEEK = weekByMonday('2026-10-19'); // пн 19 окт .. вс 25 окт
const SUNDAY_EVENING = new Date('2026-10-25T16:00:00Z');
const TOKEN = '123:SECRET-TOKEN';
const okFetch = () => vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }));
const sentTo = (f: ReturnType<typeof okFetch>) => f.mock.calls.map((c) => JSON.parse((c[1] as unknown as { body: string }).body) as { chat_id: string; text: string });

describe('сводка (БД)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(userId: typeof A, titleId: string, name = titleId) {
    const [g] = await t.db.insert(games).values({ userId, titleId, name, category: 'ps5_native_game', lastSeenAt: SUNDAY_EVENING }).returning({ id: games.id });
    return g.id;
  }
  async function earn(userId: typeof A, gameId: number, np: string, list: { type: 'platinum' | 'gold' | 'bronze'; at: string | null }[]) {
    const [s] = await t.db.insert(trophySets).values({ userId, npCommunicationId: np, npServiceName: 'trophy2', name: np }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId, gameId, trophySetId: s.id, source: 'title_id' });
    let i = 0;
    for (const x of list) await t.db.insert(trophies).values({ userId, trophySetId: s.id, trophyId: i++, type: x.type, earned: x.at !== null, earnedAt: x.at ? new Date(x.at) : null });
  }
  const snap = (userId: typeof A, gameId: number, date: string, seconds: number) => t.db.insert(playtimeSnapshots).values({ userId, gameId, snapshotDate: date, playDurationSeconds: seconds });
  const link = (userId: typeof A, chatId: string) => t.db.insert(telegramChats).values({ userId, chatId });
  const base = { now: SUNDAY_EVENING, token: TOKEN, alertsChatId: '999', origin: 'https://ps.example.app' };

  describe('блоки', () => {
    it('часы: недели по снимкам, прошлая неполная = null, нет истории = null (не 0)', async () => {
      expect(await collectHours(t.db, A, WEEK)).toEqual({ weekSeconds: null, prevWeekSeconds: null, noHistory: true });
      const g = await game(A, 'G');
      await snap(A, g, '2026-10-10', 1000);
      await snap(A, g, '2026-10-18', 4600); // воскресенье прошлой недели: база
      await snap(A, g, '2026-10-25', 4600 + 7200); // воскресенье этой недели
      expect(await collectHours(t.db, A, WEEK)).toEqual({ weekSeconds: 7200, prevWeekSeconds: 3600, noHistory: false });
      // первый снимок внутри прошлой недели: сравнения нет
      await t.db.delete(playtimeSnapshots);
      await snap(A, g, '2026-10-14', 100);
      await snap(A, g, '2026-10-25', 7300);
      const h = await collectHours(t.db, A, WEEK);
      expect(h.prevWeekSeconds).toBeNull();
      expect(h.weekSeconds).toBe(7200);
      // первый снимок после воскресенья недели: данных за неделю нет
      await t.db.delete(playtimeSnapshots);
      await snap(A, g, '2026-10-26', 100);
      expect((await collectHours(t.db, A, WEEK)).weekSeconds).toBeNull();
    });

    it('трофеи по earned_at: границы МСК, платина с названием игры, скрытые сеты не считаются', async () => {
      const g = await game(A, 'HADES', 'Hades II');
      const hidden = await game(A, 'H');
      await t.db.update(games).set({ hiddenAt: SUNDAY_EVENING }).where(eq(games.id, hidden));
      await earn(A, g, 'NP1', [
        { type: 'platinum', at: '2026-10-18T21:00:00Z' }, // пн 00:00 МСК: входит
        { type: 'gold', at: '2026-10-18T20:59:59Z' }, // вс прошлой недели: не входит
        { type: 'bronze', at: '2026-10-25T20:59:59Z' }, // вс 23:59:59 МСК: входит
        { type: 'bronze', at: '2026-10-25T21:00:00Z' }, // следующий пн: не входит
        { type: 'bronze', at: null },
      ]);
      await earn(A, hidden, 'NP2', [{ type: 'platinum', at: '2026-10-20T10:00:00Z' }]);
      const r = await collectTrophies(t.db, A, WEEK);
      expect(r.total).toBe(2);
      expect(r.platinums).toBe(1);
      expect(r.platinumGames).toEqual([{ gameId: g, title: 'Hades II' }]);
    });
  });

  describe('отправка', () => {
    it('владелец без привязки получает в чат алертов; полный текст уходит один раз', async () => {
      const g = await game(A, 'G', 'Control');
      await earn(A, g, 'NP', [{ type: 'bronze', at: '2026-10-20T10:00:00Z' }]);
      const f = okFetch();
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f })).toBe('sent');
      const [m] = sentTo(f);
      expect(m.chat_id).toBe('999');
      expect(m.text).toContain('PS Tracker: итоги недели, 19–25 окт');
      expect(m.text).toContain('+1 трофей.');
      expect(JSON.stringify(f.mock.calls)).toContain(TOKEN); // токен только в URL запроса
      const [st] = await t.db.select().from(digestState).where(eq(digestState.userId, A));
      expect(st.lastWeek).toBe('2026-10-19');
    });

    it('идемпотентность: повторный и параллельный запуск не дублируют', async () => {
      await link(A, '111');
      const f = okFetch();
      const [x, y] = await Promise.all([runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f }), runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f })]);
      expect([x, y].sort()).toEqual(['already_sent', 'sent']);
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f })).toBe('already_sent');
      // догоняющий запуск в понедельник за ту же неделю тоже ничего не шлёт
      expect(await runDigest(t.db, { ...base, now: new Date('2026-10-26T16:00:00Z'), fetchImpl: f }).then((r) => r?.results.find((u) => u.userId === A)?.result)).toBe('already_sent');
      expect(f).toHaveBeenCalledTimes(1);
      expect((await t.db.select().from(notifyLog)).map((r) => r.kind)).toEqual([`digest:${A}:2026-10-19`]);
    });

    it('сбой Telegram снимает отметку: повтор возможен', async () => {
      await link(A, '111');
      const bad = vi.fn(async () => new Response('{"ok":false}', { status: 500 }));
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: bad })).toBe('send_failed');
      expect(await t.db.select().from(notifyLog)).toEqual([]);
      const throwing = vi.fn(async () => { throw new Error(`fetch https://api.telegram.org/bot${TOKEN}/sendMessage failed`); });
      const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: throwing })).toBe('send_failed');
      expect(JSON.stringify(errs.mock.calls)).not.toContain('SECRET');
      errs.mockRestore();
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: okFetch() })).toBe('sent');
    });

    it('сбой сбора одного блока: блок пропущен, остальное уходит; все блоки упали: ничего не уходит, отметка снята', async () => {
      await link(A, '111');
      const g = await game(A, 'G');
      await earn(A, g, 'NP', [{ type: 'bronze', at: '2026-10-20T10:00:00Z' }]);
      const f = okFetch();
      const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
      const boom = () => Promise.reject(new Error('boom'));
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f, collectors: { ...defaultCollectors, plan: boom, advice: boom } })).toBe('sent');
      expect(sentTo(f)[0].text).toContain('+1 трофей.');
      expect(sentTo(f)[0].text).not.toContain('План');
      await t.db.delete(notifyLog);
      const f2 = okFetch();
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f2, collectors: { hours: boom, trophies: boom, plan: boom, advice: boom, statuses: boom } })).toBe('error');
      expect(f2).not.toHaveBeenCalled();
      expect(await t.db.select().from(notifyLog)).toEqual([]);
      errs.mockRestore();
    });

    it('участник без привязки: no_target; без токена: telegram_disabled; блокированный не получает', async () => {
      const f = okFetch();
      expect(await runDigestForUser(t.db, { id: B, role: 'member' }, WEEK, { ...base, fetchImpl: f })).toBe('no_target');
      expect(await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, token: null, fetchImpl: f })).toBe('telegram_disabled');
      await link(B, '222');
      await t.db.execute(sql.raw(`update allowed_users set status = 'blocked' where id = 2`));
      const r = await runDigest(t.db, { ...base, fetchImpl: f });
      expect(r?.results.map((x) => x.userId)).toEqual([A]);
      await t.db.execute(sql.raw(`update allowed_users set status = 'active' where id = 2`));
    });

    it('владелец с привязанным чатом получает в него, а не в чат алертов', async () => {
      await link(A, '777');
      const f = okFetch();
      await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: f });
      expect(sentTo(f)[0].chat_id).toBe('777');
    });

    it('изоляция: у каждого своё содержимое и свой чат, чужие данные не попадают', async () => {
      const ga = await game(A, 'GA', 'Игра Артёма');
      const gb = await game(B, 'GB', 'Игра Бориса');
      await earn(A, ga, 'NPA', [{ type: 'platinum', at: '2026-10-20T10:00:00Z' }, { type: 'bronze', at: '2026-10-21T10:00:00Z' }]);
      await earn(B, gb, 'NPB', [{ type: 'bronze', at: '2026-10-22T10:00:00Z' }]);
      await snap(A, ga, '2026-10-10', 0);
      await snap(A, ga, '2026-10-25', 3600);
      await snap(B, gb, '2026-10-10', 0);
      await snap(B, gb, '2026-10-25', 36000);
      await link(A, '111');
      await link(B, '222');
      const f = okFetch();
      const r = await runDigest(t.db, { ...base, fetchImpl: f });
      expect(r?.results).toEqual([{ userId: A, result: 'sent' }, { userId: B, result: 'sent' }]);
      const [ma, mb] = sentTo(f);
      expect([ma.chat_id, mb.chat_id]).toEqual(['111', '222']);
      expect(ma.text).toContain('Сыграно 1 ч за неделю');
      expect(ma.text).toContain('+2 трофея, платин: 1.');
      expect(ma.text).toContain('Платина: Игра Артёма');
      expect(ma.text).not.toContain('Бориса');
      expect(mb.text).toContain('Сыграно 10 ч за неделю');
      expect(mb.text).toContain('+1 трофей.');
      expect(mb.text).not.toContain('Артёма');
      expect(mb.text).not.toContain('Платина');
      // ключи дедупа раздельные
      expect((await t.db.select().from(notifyLog)).map((x) => x.kind).sort()).toEqual([`digest:${A}:2026-10-19`, `digest:${B}:2026-10-19`]);
    });

    it('не день сводки: runDigest = null; force работает; бюджет исчерпан: skipped без отметки', async () => {
      const f = okFetch();
      expect(await runDigest(t.db, { ...base, now: new Date('2026-10-28T16:00:00Z'), fetchImpl: f })).toBeNull();
      await link(A, '111');
      const forced = await runDigest(t.db, { ...base, now: new Date('2026-10-28T16:00:00Z'), force: true, fetchImpl: f });
      expect(forced?.week).toBe('2026-10-26');
      await t.db.delete(notifyLog);
      const r = await runDigest(t.db, { ...base, budgetMs: -1, fetchImpl: f });
      expect(r?.results.every((x) => x.result === 'skipped')).toBe(true);
      expect(await t.db.select().from(notifyLog)).toEqual([]);
    });

    it('совет не повторяется: id прошлого совета исключается', async () => {
      const calls: (number | null)[] = [];
      const collectors = { ...defaultCollectors, advice: async (_d: unknown, _u: unknown, _n: Date, last: number | null) => { calls.push(last); return { gameId: 5, title: 'Tunic', reason: 'потому что' }; } };
      await link(A, '111');
      await runDigestForUser(t.db, { id: A, role: 'owner' }, WEEK, { ...base, fetchImpl: okFetch(), collectors: collectors as never });
      await runDigestForUser(t.db, { id: A, role: 'owner' }, weekByMonday('2026-10-26'), { ...base, fetchImpl: okFetch(), collectors: collectors as never });
      expect(calls).toEqual([null, 5]);
    });

    it('collectDigest без исключений даже на пустой БД', async () => {
      const r = await collectDigest(t.db, A, WEEK, { now: SUNDAY_EVENING, lastAdviceGameId: null });
      expect(r.failed).toBe(0);
      expect(r.data.advice).toBeNull();
      expect(r.data.statuses).toBe(0);
    });
  });
});
