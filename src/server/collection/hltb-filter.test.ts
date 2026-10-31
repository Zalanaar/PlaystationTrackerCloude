// Контракт 16.4: фильтр hltb=found|not_found|unchecked и hltbCounts (PGlite).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { listGames } from './query';
import { parseListQuery } from './validation';

const { games, gameStatus } = schema;
const NOW = new Date('2026-10-28T10:00:00Z');

describe('GET /api/games: hltb', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
    const rows = [
      { titleId: 'A', name: 'Alpha', hltbId: 1, hltbMainHours: 5, hltbCheckedAt: NOW },
      { titleId: 'B', name: 'Bravo', hltbId: null, hltbCheckedAt: NOW },
      { titleId: 'C', name: 'Charlie', hltbId: null, hltbCheckedAt: NOW, durationOverrideHours: 12 },
      { titleId: 'D', name: 'Delta' },
      { titleId: 'E', name: 'Echo', psnGenres: ['ACTION'] },
    ];
    const ins = await t.db.insert(games).values(rows.map((r) => ({ ...base, ...r }))).returning({ id: games.id, titleId: games.titleId });
    await t.db.insert(gameStatus).values(['A', 'B', 'C'].map((k) => ({ gameId: ins.find((x) => x.titleId === k)!.id, status: 'backlog' as const })));
    await t.db.insert(gameStatus).values({ gameId: ins.find((x) => x.titleId === 'E')!.id, status: 'playing' });
  });
  const list = async (q: string) => {
    const p = parseListQuery(new URLSearchParams(q));
    if (!p.ok) throw new Error(p.message);
    return listGames(t.db, TEST_USER, p.value, NOW);
  };
  it('N-3: unchecked не считает игры с ручной длительностью и сервисы', async () => {
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
    const ins = await t.db.insert(games).values([
      { ...base, titleId: 'S', name: 'Service' },
      { ...base, titleId: 'O', name: 'Override', durationOverrideHours: 8 },
    ]).returning({ id: games.id, titleId: games.titleId });
    await t.db.insert(gameStatus).values({ gameId: ins.find((x) => x.titleId === 'S')!.id, status: 'service' });
    // D и E (без hltb) остаются, S (service) и O (override) не считаются
    expect((await list('')).hltbCounts).toEqual({ found: 1, not_found: 2, unchecked: 2 });
  });

  it('фильтр hltb=unchecked совпадает со счётчиком: без override и сервисов', async () => {
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
    const ins = await t.db.insert(games).values([
      { ...base, titleId: 'S', name: 'Service' },
      { ...base, titleId: 'O', name: 'Override', durationOverrideHours: 8 },
    ]).returning({ id: games.id, titleId: games.titleId });
    await t.db.insert(gameStatus).values({ gameId: ins.find((x) => x.titleId === 'S')!.id, status: 'service' });
    const r = await list('hltb=unchecked&sort=title');
    expect(names(r)).toEqual(['Delta', 'Echo']);
    expect(r.total).toBe(r.hltbCounts.unchecked);
    expect(names(await list('hltb=found,unchecked&sort=title'))).toEqual(['Alpha', 'Delta', 'Echo']);
  });

  const names = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);

  it('фильтр по одному и нескольким статусам (ИЛИ), с остальными фильтрами И', async () => {
    expect(names(await list('hltb=not_found&sort=title'))).toEqual(['Bravo', 'Charlie']);
    expect(names(await list('hltb=found,unchecked&sort=title'))).toEqual(['Alpha', 'Delta', 'Echo']);
    expect(names(await list('hltb=not_found&status=backlog&q=bra'))).toEqual(['Bravo']);
    expect(names(await list('hltb=unchecked&genres=ACTION'))).toEqual(['Echo']);
  });

  it('ручное значение не влияет на статус: Charlie с override остаётся not_found', async () => {
    const r = await list('hltb=not_found&sort=title');
    const c = r.items.find((i) => i.title === 'Charlie')!;
    expect(c.duration).toMatchObject({ source: 'manual', hours: 12 });
    expect(c.duration?.hltb.status).toBe('not_found');
  });

  it('hltbCounts считается без фильтра hltb, но с остальными', async () => {
    expect((await list('hltb=found')).hltbCounts).toEqual({ found: 1, not_found: 2, unchecked: 2 });
    expect((await list('status=backlog')).hltbCounts).toEqual({ found: 1, not_found: 2, unchecked: 0 });
    expect((await list('')).hltbCounts).toEqual({ found: 1, not_found: 2, unchecked: 2 });
  });

  it('counts статусов учитывают фильтр hltb', async () => {
    const r = await list('hltb=not_found');
    expect(r.counts.backlog).toBe(2);
    expect(r.total).toBe(2);
  });

  it('неизвестное значение = 400', () => {
    expect(parseListQuery(new URLSearchParams('hltb=zzz')).ok).toBe(false);
    expect(parseListQuery(new URLSearchParams('hltb=found,zzz')).ok).toBe(false);
  });
});

describe('hltb: регистр значений не важен', () => {
  it('FOUND, Not_Found = found, not_found', async () => {
    const { parseListQuery } = await import('./validation');
    const r = parseListQuery(new URLSearchParams('hltb=FOUND,Not_Found'));
    expect(r.ok && r.value.hltb).toEqual(['found', 'not_found']);
  });
});
