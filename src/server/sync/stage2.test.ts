// Этап 2: group_id трофеев (15.3) и цвет акцента (15.2) в синке, PGlite + фейковый PSN.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import { getGameDetails } from '@/server/collection/details';
import { runChunk, type SyncDeps } from './engine';
import { startRun } from './runs';
import type { TintDeps } from './tint';
import { createTestDb, fakeApi, freshState, type FakeState, type TestDb } from './test-helpers';
import { TEST_USER } from '@/server/sync/test-helpers';

const { games, trophies, syncRuns } = schema;
const DAY1 = new Date('2026-10-27T17:00:00Z');
const DAY2 = new Date('2026-10-28T17:00:00Z');

describe('Этап 2: синк', () => {
  let t: TestDb;
  let state: FakeState;
  const clock = { t: DAY1.getTime() };
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    state = freshState();
    clock.t = DAY1.getTime();
  });

  const deps = (tint?: TintDeps): SyncDeps => ({
    db: t.db,
    now: () => new Date(clock.t),
    budgetMs: 1_000_000,
    tint,
    connect: () =>
      connectPsn({
        getAccessToken: async () => 'test-token',
        onlineId: 'Target',
        delayMs: 0,
        api: fakeApi(state),
        sleep: async (ms) => {
          clock.t += ms;
        },
        now: () => clock.t,
      }),
  });
  async function sync(tint?: TintDeps) {
    for (let i = 0; i < 30; i++) {
      const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
      if (s.kind !== 'started') throw new Error(s.kind);
      const res = await runChunk(deps(tint), s.run);
      if (!res.continueNext) return { res, runId: s.run.id };
    }
    throw new Error('цепочка не закончилась');
  }

  describe('trophies.group_id (15.3)', () => {
    it('синк заполняет group_id из определений', async () => {
      await sync();
      const rows = await t.db.select({ g: trophies.groupId }).from(trophies);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.g === 'default')).toBe(true);
    });

    it('сет со строками без group_id перезагружается не раньше чем через сутки и заполняется; свежие сеты не трогаются', async () => {
      await sync();
      const before = state.calls.defs ?? 0;
      await t.db.update(trophies).set({ groupId: null });
      // свежий синк (меньше суток): перезагрузки нет
      clock.t = DAY1.getTime() + 3600_000;
      await sync();
      expect(state.calls.defs ?? 0).toBe(before);
      expect(await t.db.select().from(trophies).where(isNull(trophies.groupId)).then((r) => r.length)).toBeGreaterThan(0);
      // на следующие сутки: все заполнены, повтор идемпотентен (число строк то же)
      const count = (await t.db.select().from(trophies)).length;
      clock.t = DAY2.getTime() + 2 * 3600_000;
      const { res } = await sync();
      expect(res.status).toBe('success');
      expect(await t.db.select().from(trophies).where(isNull(trophies.groupId)).then((r) => r.length)).toBe(0);
      expect((await t.db.select().from(trophies)).length).toBe(count);
      // и ещё один синк: ничего не перезагружается
      const defs = state.calls.defs ?? 0;
      clock.t = DAY2.getTime() + 4 * 86400_000;
      await sync();
      // допускаются только перезагрузки по другим причинам; групповых нет
      expect(await t.db.select().from(trophies).where(isNull(trophies.groupId)).then((r) => r.length)).toBe(0);
      expect(state.calls.defs ?? 0).toBeGreaterThanOrEqual(defs);
    });

    it('добор частичный и идемпотентный: перезагружается только сет с NULL, заполненные не трогаются, повтор ничего не меняет (Фаза 36)', async () => {
      await sync();
      const sets = await t.db.selectDistinct({ id: trophies.trophySetId }).from(trophies);
      expect(sets.length).toBeGreaterThan(1);
      const target = sets[0].id;
      await t.db.update(trophies).set({ groupId: null }).where(eq(trophies.trophySetId, target));
      const total = (await t.db.select().from(trophies)).length;
      const before = state.calls.defs ?? 0;
      clock.t = DAY2.getTime() + 2 * 3600_000;
      await sync();
      expect(state.calls.defs ?? 0).toBe(before + 1); // одна перезагрузка определений: только сет с NULL
      expect(await t.db.select().from(trophies).where(isNull(trophies.groupId)).then((r) => r.length)).toBe(0);
      const rows = await t.db.select({ s: trophies.trophySetId, g: trophies.groupId }).from(trophies);
      expect(rows).toHaveLength(total);
      expect(rows.every((r) => r.g === 'default')).toBe(true);
      // повторный синк через сутки: перезагрузок по group_id больше нет
      const after = state.calls.defs ?? 0;
      clock.t = DAY2.getTime() + 2 * 86400_000;
      await sync();
      expect(state.calls.defs ?? 0).toBe(after);
      expect((await t.db.select().from(trophies)).length).toBe(total);
    });

    it('DLC: прогноз платины считает базу отдельно от DLC; без group_id помечен приблизительным', async () => {
      const np = 'NPWR00003_00';
      const set = state.trophies[np] as { defs: Record<string, unknown>[]; earned: Record<string, unknown>[] };
      // платина не получена; база: бронза 1 (получена); DLC: бронза 2 и 3 (не получены)
      set.earned[0] = { ...set.earned[0], earned: false, earnedDateTime: undefined };
      for (const id of [2, 3]) {
        set.defs.push({ trophyId: id, trophyHidden: false, trophyType: 'bronze', trophyName: `DLC${id}`, trophyDetail: 'd', trophyIconUrl: 'https://img.example/d.png', trophyGroupId: '001' });
        set.earned.push({ trophyId: id, trophyHidden: false, earned: false, trophyType: 'bronze', trophyRare: 3, trophyEarnedRate: '50.0' });
      }
      state.trophyTitles.find((x) => x.npCommunicationId === np)!.definedTrophies = { bronze: 3, silver: 0, gold: 0, platinum: 1 };
      await sync();
      const res = await t.db.execute(sql`select l.game_id from game_trophy_sets l join trophy_sets s on s.id = l.trophy_set_id where s.np_communication_id = ${np} limit 1`);
      const gameId = ((Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { game_id: number }[])[0].game_id;
      const d = await getGameDetails(t.db, TEST_USER, gameId);
      expect(d?.trophyList.filter((x) => x.groupId === '001')).toHaveLength(2);
      expect(d?.platinumForecast).toMatchObject({ required: 1, earned: 1, progress: 100, remaining: { total: 0 }, approximate: false, dlc: { required: 2, earned: 0, remaining: 2 } });
      // группа неизвестна: DLC считаются базой, прогноз приблизительный
      await t.db.update(trophies).set({ groupId: null }).where(eq(trophies.trophySetId, d!.trophyList[0].setId));
      const d2 = await getGameDetails(t.db, TEST_USER, gameId);
      expect(d2?.platinumForecast).toMatchObject({ required: 3, earned: 1, approximate: true, dlc: null });
    });
  });

  describe('tint (15.2)', () => {
    const okDeps = (calls: string[] = []): TintDeps => ({
      fetchBytes: async (u) => {
        calls.push(u);
        return new Uint8Array([1]);
      },
      decode: async () => '#3366cc',
    });

    it('после успешного синка у игр с обложкой появляется tint; повторный синк ничего не пересчитывает', async () => {
      const calls: string[] = [];
      const { res } = await sync(okDeps(calls));
      expect(res.status).toBe('success');
      const withImg = await t.db.select({ id: games.id, tint: games.tint }).from(games).where(sql`${games.imageUrl} is not null`);
      expect(withImg.length).toBeGreaterThan(0);
      expect(withImg.every((g) => g.tint === '#3366cc')).toBe(true);
      const n = calls.length;
      clock.t = DAY2.getTime();
      await sync(okDeps(calls));
      expect(calls.length).toBe(n);
    });

    it('ошибка обложки не роняет синк: tint null, tint_checked_at, предупреждение; повтор через 7 дней', async () => {
      const bad: TintDeps = { fetchBytes: async () => { throw new Error('404'); }, decode: async () => null };
      const { res, runId } = await sync(bad);
      expect(res.status).toBe('success');
      const [g] = await t.db.select().from(games).where(sql`${games.imageUrl} is not null`).limit(1);
      expect(g.tint).toBeNull();
      expect(g.tintCheckedAt).not.toBeNull();
      const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
      expect((run.warnings as { code: string }[]).some((w) => w.code === 'tint_failed')).toBe(true);
      const calls: string[] = [];
      clock.t = DAY2.getTime(); // < 7 дней: не повторяем
      await sync(okDeps(calls));
      expect(calls.length).toBe(0);
      clock.t = DAY1.getTime() + 8 * 86400_000;
      await sync(okDeps(calls));
      expect(calls.length).toBeGreaterThan(0);
    });

    it('смена image_url сбрасывает tint', async () => {
      await sync(okDeps());
      const t0 = state.titles[0] as { imageUrl?: string; localizedImageUrl?: string; titleId: string };
      t0.imageUrl = 'https://img.example/new-cover.png';
      clock.t = DAY2.getTime();
      const calls: string[] = [];
      await sync({ ...okDeps(calls), decode: async () => '#aa3333' });
      const [g] = await t.db.select().from(games).where(eq(games.titleId, t0.titleId));
      expect(g.imageUrl).toBe('https://img.example/new-cover.png');
      expect(g.tint).toBe('#aa3333');
      expect(calls).toEqual(['https://img.example/new-cover.png']);
    });

    it('без deps.tint шаг отключён', async () => {
      await sync();
      expect((await t.db.select().from(games).where(sql`${games.tint} is not null`)).length).toBe(0);
    });
  });
});
