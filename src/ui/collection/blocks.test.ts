import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { blockGames, buildPlan, isFull, visibleBlocks } from './blocks';

const g = (id: number, status: GameItem['status'], lastPlayedAt: string | null = null): GameItem => ({
  id, title: `G${id}`, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt, status,
  completedAt: null, droppedAt: null, trophies: null, genres: [], bannerUrl: null, hiddenAt: null,
});

describe('блоки коллекции', () => {
  it('порядок: Играю, Хроника, Бэклог, Игры-сервисы, Отложено, Не разобрано', () => {
    expect(visibleBlocks('all')).toEqual(['playing', 'chronicle', 'backlog', 'service', 'shelved', 'unsorted']);
    expect(visibleBlocks('service')).toEqual(['service']);
    expect(visibleBlocks('completed')).toEqual(['chronicle']);
    expect(visibleBlocks('dropped')).toEqual(['chronicle']);
    expect(visibleBlocks('none')).toEqual(['unsorted']);
  });
  it('превью только при «Все» для бэклога и не разобранного', () => {
    expect(isFull('backlog', 'all')).toBe(false);
    expect(isFull('unsorted', 'all')).toBe(false);
    expect(isFull('shelved', 'all')).toBe(true);
    expect(isFull('service', 'all')).toBe(true);
    expect(isFull('backlog', 'backlog')).toBe(true);
  });
  it('с чипом «Платина» (фильтр на клиенте) превью-блоки грузятся целиком', () => {
    expect(isFull('backlog', 'all', true)).toBe(true);
    const plan = buildPlan('all', '', true);
    expect(plan.find((p) => p.block === 'backlog')!.query.get('limit')).toBe('300');
    expect(plan.find((p) => p.block === 'unsorted')!.query.get('limit')).toBe('300');
    expect(plan.find((p) => p.block === 'playing')!.query.get('limit')).toBe('20');
  });
  it('план запросов: хроника из completed,dropped по completed_at, лимит 300', () => {
    const plan = buildPlan('all', '');
    const chron = plan.find((p) => p.block === 'chronicle')!;
    expect(chron.query.get('status')).toBe('completed,dropped');
    expect(chron.query.get('sort')).toBe('completed_at');
    expect(chron.query.get('limit')).toBe('300');
    expect(plan.find((p) => p.block === 'backlog')!.query.get('limit')).toBe('12');
    expect(plan.find((p) => p.block === 'service')!.query.get('status')).toBe('service');
    expect(buildPlan('completed', 'x')[0].query.get('status')).toBe('completed');
    expect(buildPlan('completed', 'x')[0].query.get('q')).toBe('x');
  });
  it('игры блока из пула: статус определяет блок, не-хроника по последнему запуску', () => {
    const pool = [g(1, 'backlog', '2026-01-01T00:00:00Z'), g(2, 'backlog', '2026-05-01T00:00:00Z'), g(3, 'completed'), g(4, null)];
    expect(blockGames(pool, 'backlog', 'all').map((x) => x.id)).toEqual([2, 1]);
    expect(blockGames(pool, 'unsorted', 'all').map((x) => x.id)).toEqual([4]);
    expect(blockGames(pool, 'chronicle', 'all').map((x) => x.id)).toEqual([3]);
    const withService = [...pool, g(5, 'service', '2026-07-01T00:00:00Z'), g(6, 'service', '2026-08-01T00:00:00Z')];
    expect(blockGames(withService, 'service', 'all').map((x) => x.id)).toEqual([6, 5]);
    expect(blockGames(withService, 'chronicle', 'all').map((x) => x.id)).toEqual([3]);
    expect(blockGames(withService, 'backlog', 'all').map((x) => x.id)).toEqual([2, 1]);
  });
});
