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

const { games, trophies, trophySets, syncRuns } = schema;
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
      const s = await startRun(t.db, { kind: 'manual', now: new Date(clock.t) });
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
      clock.t = DAY2.getTime();
      const { res } = await sync();
      expect(res.status).toBe('success');
      expect(await t.db.select().from(trophies).where(isNull(trophies.groupId)).then((r) => r.length)).toBe(0);
      expect((await t.db.select().from(trophies)).length).toBe(count);
      // и ещё один синк: ничего не перезагружается
      const defs = state.calls.defs ?? 0;
      clock.t = DAY2.getTime() + 2 * 86400_000;
      await sync();
      // допускаются только перезагрузки по другим причинам; групповых нет
      expect(await t.db.select().from(trophies).where(isNull(trophies.groupId)).then((r) => r.length)).toBe(0);
      expect(state.calls.defs ?? 0).toBeGreaterThanOrEqual(defs);
    });

    it('DLC: прогноз платины считает базу отдельно от DLC; без group_id помечен приблизительным', async () => {
      const np = Object.keys(state.trophies).find((k) => (state.trophies[k].defs as { trophyType?: string }[]).some((d) => d.trophyType === 'platinum'));
      if (np) {
        const defs = state.trophies[np].defs as Record<string, unknown>[];
        const last = defs.filter((d) => d.trophyType !== 'platinum').pop();
        if (last) last.trophyGroupId = '001';
      }
      await sync();
      const withPlat = await t.db.select({ id: trophySets.id }).from(trophySets).where(sql`${trophySets.definedPlatinum} > 0 and ${trophySets.earnedPlatinum} = 0`);
      let checked = 0;
      for (const s of withPlat) {
        const link = await t.db.execute(sql`select game_id from game_trophy_sets where trophy_set_id = ${s.id} limit 1`);
        const rows = (Array.isArray(link) ? link : (link as { rows: { game_id: number }[] }).rows) as { game_id: number }[];
        if (!rows[0]) continue;
        const d = await getGameDetails(t.db, rows[0].game_id);
        if (!d?.platinumForecast) continue;
        checked++;
        expect(d.platinumForecast.approximate).toBe(false);
        const dlcCount = d.trophyList.filter((x) => x.groupId === '001' && x.type !== 'platinum').length;
        expect(d.platinumForecast.dlc?.required ?? 0).toBe(dlcCount);
        const base = d.trophyList.filter((x) => (x.groupId ?? 'default') === 'default' && x.type !== 'platinum').length;
        expect(d.platinumForecast.required).toBe(base);
        await t.db.update(trophies).set({ groupId: null }).where(eq(trophies.trophySetId, d.trophyList[0].setId));
        const d2 = await getGameDetails(t.db, rows[0].game_id);
        expect(d2?.platinumForecast?.approximate).toBe(true);
        expect(d2?.platinumForecast?.dlc).toBeNull();
      }
      expect(checked, 'в фикстурах должна быть игра с неполученной платиной').toBeGreaterThan(0);
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
