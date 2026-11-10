// Пакет 5: группы трофеев (названия DLC), русские тексты (Accept-Language ru-RU) и дозагрузка локали для уже загруженных сетов.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import type { PsnApi } from '@/server/psn/client';
import { runChunk, type SyncDeps } from './engine';
import { LOCALE_PER_RUN } from './phases';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, TEST_USER, type FakeState, type TestDb } from './test-helpers';

const { trophySets, trophies, trophyGroups, trophySetLocales, syncRuns } = schema;
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
  async function full(o: Partial<SyncDeps> = {}) {
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
    if (s.kind !== 'started') throw new Error(s.kind);
    let res = await runChunk({ ...deps(), ...o }, s.run);
    let hops = 1;
    for (let i = 0; res.continueNext && i < 50; i++) {
      const c = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t), continueRunId: s.run.id });
      if (c.kind !== 'started') throw new Error(c.kind);
      res = await runChunk({ ...deps(), ...o }, c.run);
      hops++;
    }
    return { ...res, hops, runId: s.run.id };
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

  // Пакет 6, п. 10: все старые сеты за один запуск (раньше 20 за звено, остальное ждало следующих синков)
  async function oldSets(n: number) {
    await full();
    await t.db.delete(trophySetLocales);
    const now = new Date(clock.t);
    await t.db.insert(trophySets).values(Array.from({ length: n }, (_, i) => ({
      userId: 1, npCommunicationId: `NPWR9${String(i).padStart(4, '0')}_00`, npServiceName: 'trophy2', name: `Old ${i}`, definedBronze: 0, trophiesSyncedAt: now,
    })));
    const total = (await t.db.select().from(trophySets).where(isNotNull(trophySets.trophiesSyncedAt))).length;
    clock.t += 3_600_000;
    state.calls = {};
    return total;
  }
  const marked = async () => (await t.db.select().from(trophySetLocales)).length;
  const pace = () => {
    const p = { calls: 0, ms: 500, sleep: async (ms: number) => { p.calls++; clock.t += ms; } };
    return p;
  };

  it('п. 10: 45 старых сетов — все за один запуск через несколько звеньев, с паузой между сетами', async () => {
    const total = await oldSets(45);
    const p = pace();
    // бюджет звена 5 с, пауза 0,5 с: ~10 сетов за звено — звено кончается по времени и запуск продолжается
    const r = await full({ budgetMs: 5_000, localePace: p });
    expect(r.status).toBe('success');
    expect(r.hops).toBeGreaterThan(3);
    expect(await marked()).toBe(total);
    expect(state.calls.defs).toBeGreaterThanOrEqual(total); // по запросу на сет (длинные — страницами)
    expect(p.calls).toBeGreaterThanOrEqual(total - r.hops);
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, r.runId));
    expect(run.warnings).toEqual([]);
    // следующий синк уже ничего не перечитывает
    state.calls = {};
    clock.t += 3_600_000;
    await full();
    expect(state.calls.defs ?? 0).toBe(0);
  });

  it('п. 10: лимит PSN (429 и после повторов) — дозагрузка стоп до следующего синка, синк успешен', async () => {
    const total = await oldSets(10);
    state.failOn.set('defs', { error: new Error('429 Too Many Requests'), times: 4 });
    const r = await full();
    expect(r.status).toBe('success');
    // 1 запрос + 3 повтора клиента и стоп: остальные сеты не трогаем
    expect(state.calls.defs).toBe(4);
    expect(await marked()).toBe(0);
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, r.runId));
    expect((run.warnings as { code: string }[]).map((w) => w.code)).toEqual(['trophy_locale_failed']);
    clock.t += 3_600_000;
    expect((await full()).status).toBe('success');
    expect(await marked()).toBe(total);
  });

  it('п. 10: нет доступа к одному сету — предупреждение и дальше; токен/сбой PSN — стоп', async () => {
    const total = await oldSets(6);
    state.failOn.set('defs', { error: new Error('404 resource not found'), times: 1 });
    await full();
    expect(await marked()).toBe(total - 1);
    await t.db.delete(trophySetLocales);
    clock.t += 3_600_000;
    state.calls = {};
    state.failOn.set('defs', { error: new Error('Service Unavailable 503'), times: 4 });
    await full();
    expect(state.calls.defs).toBe(4);
    expect(await marked()).toBe(0);
  });

  it('п. 10: не больше LOCALE_PER_RUN сетов за запуск (счёт идёт через звенья в курсоре)', async () => {
    await oldSets(5);
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
    if (s.kind !== 'started') throw new Error(s.kind);
    await t.db.update(syncRuns).set({ phase: 'trophies', cursor: { phase: 'trophies', hops: 1, locale: LOCALE_PER_RUN - 2 } }).where(eq(syncRuns.id, s.run.id));
    const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, s.run.id));
    expect((await runChunk(deps(), row)).status).toBe('success');
    expect(await marked()).toBe(2);
  });
});
