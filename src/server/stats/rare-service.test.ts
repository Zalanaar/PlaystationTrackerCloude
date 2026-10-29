// Фаза 17.2 (контракт 20.8): «Редкие трофеи» без игр-сервисов по умолчанию, withService возвращает их.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';
import { parseWrappedQuery } from '@/server/wrapped/validation';
import { getStats } from './query';
import { getRareTrophies } from './rare-query';
import { parseStatsQuery, parseWithService } from './validation';

const { games, gameStatus, trophySets, gameTrophySets, trophies } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('редкие трофеи и игры-сервисы', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(status: 'service' | 'completed' | 'backlog' | null) {
    n++;
    const [g] = await t.db.insert(games).values({ titleId: `CUSA${n}`, name: `G${n}`, category: 'ps5_native_game', lastSeenAt: NOW }).returning();
    if (status) await t.db.insert(gameStatus).values({ gameId: g.id, status });
    return g.id;
  }
  async function trophy(gameIds: number[], name: string, rate: string, at = '2026-05-01T10:00:00Z') {
    n++;
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: `NPWR${n}`, npServiceName: 'trophy2', name }).returning();
    for (const id of gameIds) await t.db.insert(gameTrophySets).values({ gameId: id, trophySetId: s.id, source: 'title_id' });
    await t.db.insert(trophies).values({ trophySetId: s.id, trophyId: 1, type: 'gold', name, earned: true, earnedAt: new Date(at), earnedRate: rate });
  }
  const names = (r: { setName: string }[]) => r.map((x) => x.setName);
  const year = { fromUtc: new Date('2025-12-31T21:00:00Z'), toUtc: new Date('2026-12-31T21:00:00Z') };

  async function seed() {
    const cod = await game('service');
    const done = await game('completed');
    const none = await game(null);
    await trophy([cod], 'CoD', '0.10');
    await trophy([done], 'Done', '1.00');
    await trophy([none], 'NoStatus', '2.00');
    await trophy([], 'Orphan', '3.00');
  }

  it('по умолчанию трофеи сервиса исключены; сирота и игра без статуса остаются', async () => {
    await seed();
    expect(names(await getRareTrophies(t.db, year))).toEqual(['Done', 'NoStatus', 'Orphan']);
    expect(names(await getRareTrophies(t.db, null))).toEqual(['Done', 'NoStatus', 'Orphan']);
  });

  it('withService=true возвращает прежнее поведение', async () => {
    await seed();
    expect(names(await getRareTrophies(t.db, year, 5, true))).toEqual(['CoD', 'Done', 'NoStatus', 'Orphan']);
  });

  it('сет у двух версий: игра сета = минимальный id; решает её статус', async () => {
    const svc = await game('service');
    const normal = await game('completed');
    await trophy([svc, normal], 'Shared', '0.50'); // owner = svc (минимальный id)
    expect(names(await getRareTrophies(t.db, null))).toEqual([]);
    expect(names(await getRareTrophies(t.db, null, 5, true))).toEqual(['Shared']);
  });

  it('смена статуса сервиса на другой возвращает трофеи', async () => {
    const g = await game('service');
    await trophy([g], 'Now', '0.10');
    expect(names(await getRareTrophies(t.db, null))).toEqual([]);
    await t.db.update(gameStatus).set({ status: 'completed' });
    expect(names(await getRareTrophies(t.db, null))).toEqual(['Now']);
  });

  it('лимит 5 набирается уже без сервисов (сервис не съедает места)', async () => {
    const svc = await game('service');
    const ok = await game('completed');
    for (let i = 0; i < 6; i++) await trophy([svc], `Svc${i}`, `0.0${i + 1}`);
    for (let i = 0; i < 6; i++) await trophy([ok], `Ok${i}`, `${i + 1}.00`);
    expect(names(await getRareTrophies(t.db, null))).toEqual(['Ok0', 'Ok1', 'Ok2', 'Ok3', 'Ok4']);
  });

  it('getStats и getWrapped: параметр withService; прочие трофеи статистики не меняются', async () => {
    await seed();
    const q = { type: 'year' as const, year: 2026, month: null };
    const def = await getStats(t.db, q, NOW);
    expect(names(def.rareTrophies.period)).toEqual(['Done', 'NoStatus', 'Orphan']);
    expect(names(def.rareTrophies.allTime)).toEqual(['Done', 'NoStatus', 'Orphan']);
    const withSvc = await getStats(t.db, { ...q, withService: true }, NOW);
    expect(names(withSvc.rareTrophies.period)).toEqual(['CoD', 'Done', 'NoStatus', 'Orphan']);
    expect(withSvc.trophies).toEqual(def.trophies); // сводка трофеев не зависит от параметра
    const w = await getWrapped(t.db, 2026, null, NOW);
    expect(names(w.trophies.rare)).toEqual(['Done', 'NoStatus', 'Orphan']);
    const w2 = await getWrapped(t.db, 2026, null, NOW, { withService: true });
    expect(names(w2.trophies.rare)).toEqual(['CoD', 'Done', 'NoStatus', 'Orphan']);
  });
});

describe('разбор withService', () => {
  it('parseWithService: 1|true, 0|false|нет, иное = null', () => {
    expect(parseWithService(null)).toBe(false);
    expect(parseWithService('0')).toBe(false);
    expect(parseWithService('false')).toBe(false);
    expect(parseWithService('1')).toBe(true);
    expect(parseWithService('true')).toBe(true);
    for (const v of ['', 'yes', 'TRUE', '2', ' 1']) expect(parseWithService(v), v).toBeNull();
  });
  it('parseStatsQuery: поле появляется только при включении; мусор = ошибка', () => {
    const p = (q: string) => parseStatsQuery(new URLSearchParams(q), 2026);
    expect(p('period=year')).toEqual({ ok: true, value: { type: 'year', year: 2026, month: null } });
    expect(p('period=year&withService=1')).toEqual({ ok: true, value: { type: 'year', year: 2026, month: null, withService: true } });
    expect(p('period=month&month=3&withService=true')).toMatchObject({ ok: true, value: { withService: true } });
    expect(p('withService=0')).toMatchObject({ ok: true });
    expect(p('withService=maybe').ok).toBe(false);
    expect(p('withService=').ok).toBe(false);
  });
  it('parseWrappedQuery', () => {
    const p = (q: string) => parseWrappedQuery(new URLSearchParams(q), 2026);
    expect(p('')).toEqual({ ok: true, value: { year: 2026 } });
    expect(p('year=2025&withService=1')).toEqual({ ok: true, value: { year: 2025, withService: true } });
    expect(p('withService=2').ok).toBe(false);
  });
});
