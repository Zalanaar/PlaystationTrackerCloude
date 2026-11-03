// item 4: пул из данных сервера совпадает с тем, что строит загрузка по сети, и применяется только к своим фильтрам.
import { describe, expect, it } from 'vitest';
import type { CollectionInitial, GameItem, GamesListResponse } from '@/server/collection/types';
import { gamesBatchUrl } from '../batchUrl';
import { buildPlan } from '../blocks';
import { DEFAULT_FILTERS } from '../filters';
import { chroniclePool, seedFromInitial } from './seed';

const counts = { all: 3, playing: 1, completed: 1, backlog: 1, dropped: 0, shelved: 0, none: 0 } as unknown as GamesListResponse['counts'];
const g = (id: number, status: GameItem['status']) => ({ id, status, title: `G${id}` }) as unknown as GameItem;
const list = (items: GameItem[], total = items.length): GamesListResponse => ({ items, total, counts, forgottenCount: 2 } as unknown as GamesListResponse);

const plan = buildPlan('all', '', false);
const url = gamesBatchUrl(plan.map((p) => p.query));
function initial(results: CollectionInitial['batch']['results']): CollectionInitial {
  return { summaryUrl: '/api/collection/summary', summary: { counts } as unknown as CollectionInitial['summary'], batchUrl: url, batch: { results }, now: 120_000, inbox: null };
}
const okAll = () => plan.map((p, i) => ({ ok: true as const, data: list([g(i + 1, p.block === 'playing' ? 'playing' : p.block === 'backlog' ? 'backlog' : 'completed')], 10 + i) }));

describe('seedFromInitial', () => {
  it('фильтры по умолчанию: пул как у загрузки по сети', () => {
    const s = seedFromInitial(initial(okAll()), DEFAULT_FILTERS);
    expect(s).not.toBeNull();
    const net = chroniclePool(plan, okAll().map((r) => ({ status: 'fulfilled' as const, value: r.data })), [], DEFAULT_FILTERS);
    expect(s!.pool).toEqual(net);
    expect(s!.pool.items).toHaveLength(plan.length);
    expect(s!.pool.failed).toEqual([]);
    expect(s!.pool.forgotten).toBe(2);
  });

  it('другие фильтры, платина, не тот URL или длина: null', () => {
    expect(seedFromInitial(null, DEFAULT_FILTERS)).toBeNull();
    expect(seedFromInitial(initial(okAll()), { ...DEFAULT_FILTERS, status: 'backlog' })).toBeNull();
    expect(seedFromInitial(initial(okAll()), { ...DEFAULT_FILTERS, q: 'zz' })).toBeNull();
    expect(seedFromInitial(initial(okAll()), { ...DEFAULT_FILTERS, platinum: true })).toBeNull();
    expect(seedFromInitial(initial(okAll()), { ...DEFAULT_FILTERS, sort: 'title' as never })).toBeNull();
    expect(seedFromInitial({ ...initial(okAll()), batchUrl: '/api/games/batch?b=x' }, DEFAULT_FILTERS)).toBeNull();
    expect(seedFromInitial(initial(okAll().slice(1)), DEFAULT_FILTERS)).toBeNull();
  });

  it('упавший блок помечен, все упали: null', () => {
    const rs = okAll();
    rs[1] = { ok: false, code: 'db_unavailable' } as never;
    const s = seedFromInitial(initial(rs), DEFAULT_FILTERS);
    expect(s!.pool.failed).toEqual([plan[1].block]);
    expect(seedFromInitial(initial(plan.map(() => ({ ok: false as const, code: 'db_unavailable' as const }))), DEFAULT_FILTERS)).toBeNull();
  });
});
