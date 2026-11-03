// Пакет 5: группы трофеев (названия DLC), русские тексты (Accept-Language ru-RU) и дозагрузка локали для уже загруженных сетов.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import type { PsnApi } from '@/server/psn/client';
import { runChunk, type SyncDeps } from './engine';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, TEST_USER, type FakeState, type TestDb } from './test-helpers';

const { trophySets, trophies, trophyGroups, trophySetLocales } = schema;
const DAY1 = new Date('2026-10-27T17:00:00Z');
type Json = Record<string, unknown>;

describe('трофеи: группы DLC и русская локаль', () => {
  let t: TestDb;
  let state: FakeState;
  let headers: unknown[];
  const clock = { t: DAY1.getTime() };

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    state = freshState();
    headers = [];
    clock.t = DAY1.getTime();
  });

  const api = (): PsnApi => {
    const a = fakeApi(state);
    const defs = a.getTitleTrophies;
    return {
      ...a,
      getTitleTrophies: ((auth: unknown, np: string, g: string, o: { headerOverrides?: unknown }) => {
        headers.push(o?.headerOverrides);
        return (defs as (...x: unknown[]) => unknown)(auth, np, g, o);
      }) as PsnApi['getTitleTrophies'],
    };
  };
  const deps = (): SyncDeps => ({
    db: t.db,
    now: () => new Date(clock.t),
    budgetMs: 1_000_000,
    connect: () => connectPsn({ getAccessToken: async () => 'test-token', onlineId: 'Target', delayMs: 0, api: api(), sleep: async (ms) => { clock.t += ms; }, now: () => clock.t }),
  });
  async function full() {
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
    if (s.kind !== 'started') throw new Error(s.kind);
    let res = await runChunk(deps(), s.run);
    for (let i = 0; res.continueNext && i < 50; i++) {
      const c = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t), continueRunId: s.run.id });
      if (c.kind !== 'started') throw new Error(c.kind);
      res = await runChunk(deps(), c.run);
    }
    return res;
  }
  const setId = async (np: string) => (await t.db.select().from(trophySets).where(eq(trophySets.npCommunicationId, np)))[0].id;

  it('описания трофеев запрашиваются с Accept-Language ru-RU; без DLC группы не запрашиваются; сеты помечены локалью', async () => {
    expect((await full()).status).toBe('success');
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((h) => (h as Json)?.['Accept-Language'] === 'ru-RU')).toBe(true);
    expect(state.calls.groups ?? 0).toBe(0);
    const sets = await t.db.select().from(trophySets);
    const locales = await t.db.select().from(trophySetLocales);
    expect(locales.map((l) => l.locale)).toEqual(sets.filter((s) => s.trophiesSyncedAt).map(() => 'ru-RU'));
    expect(await t.db.select().from(trophyGroups)).toEqual([]);
  });

  it('сет с DLC: названия групп сохраняются (повтор не задваивает)', async () => {
    const s = state.trophies.NPWR00001_00;
    s.defs[1] = { ...s.defs[1], trophyGroupId: '001' };
    s.groups = [
      { trophyGroupId: 'default', trophyGroupName: 'Основная', trophyGroupIconUrl: 'https://g/0' },
      { trophyGroupId: '001', trophyGroupName: 'Кровавые узы', trophyGroupIconUrl: 'https://g/1', trophyGroupDetail: 'DLC' },
    ];
    await full();
    expect(state.calls.groups).toBe(1);
    const id = await setId('NPWR00001_00');
    const rows = await t.db.select().from(trophyGroups).orderBy(asc(trophyGroups.groupId));
    expect(rows.map((r) => [r.trophySetId, r.groupId, r.name, r.iconUrl, r.detail])).toEqual([
      [id, '001', 'Кровавые узы', 'https://g/1', 'DLC'],
      [id, 'default', 'Основная', 'https://g/0', null],
    ]);
  });

  it('дозагрузка локали: старые сеты без пометки перечитываются, получение не теряется', async () => {
    await full();
    const id = await setId('NPWR00001_00');
    const before = await t.db.select().from(trophies).where(eq(trophies.trophySetId, id)).orderBy(asc(trophies.trophyId));
    // как на проде до 0032: трофеи загружены, пометки локали нет, названия английские
    await t.db.delete(trophySetLocales);
    const s = state.trophies.NPWR00001_00;
    s.defs = s.defs.map((d: Json) => ({ ...d, trophyName: `RU ${d.trophyName as string}` }));
    clock.t += 3_600_000;
    headers = [];
    expect((await full()).status).toBe('success');
    const after = await t.db.select().from(trophies).where(eq(trophies.trophySetId, id)).orderBy(asc(trophies.trophyId));
    expect(after.map((r) => r.name?.slice(0, 3))).toEqual(before.map(() => 'RU '));
    expect(after.map((r) => [r.earned, r.earnedAt?.toISOString() ?? null, r.rarity])).toEqual(before.map((r) => [r.earned, r.earnedAt?.toISOString() ?? null, r.rarity]));
    expect(await t.db.select().from(trophySetLocales).where(and(eq(trophySetLocales.trophySetId, id), eq(trophySetLocales.locale, 'ru-RU')))).toHaveLength(1);
    // третий синк: всё помечено, описания больше не перечитываются ради локали
    headers = [];
    clock.t += 3_600_000;
    await full();
    expect(headers).toEqual([]);
  });
});
