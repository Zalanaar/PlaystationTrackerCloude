import { describe, expect, it } from 'vitest';
import { coalesce, isQueueable, type QueueItem } from './changeQueue';

const item = (url: string, body: string, id = '1'): QueueItem => ({ id, at: 1, method: 'PUT', url, body });

describe('очередь офлайн-изменений', () => {
  it('в очередь только статус и отзыв', () => {
    expect(isQueueable('PUT', '/api/games/3/status')).toBe(true);
    expect(isQueueable('PUT', '/api/games/3/review')).toBe(true);
    expect(isQueueable('GET', '/api/games/3/status')).toBe(false);
    expect(isQueueable('PUT', '/api/games/3/hidden')).toBe(false);
    expect(isQueueable('POST', '/api/games/3/diary')).toBe(false);
  });
  it('повторный статус той же игры заменяет предыдущий', () => {
    const a = item('/api/games/3/status', '{"status":"playing"}', 'a');
    const b = item('/api/games/3/status', '{"status":"completed"}', 'b');
    const c = item('/api/games/4/status', '{"status":"backlog"}', 'c');
    expect(coalesce(coalesce([c], a), b).map((x) => x.body)).toEqual(['{"status":"backlog"}', '{"status":"completed"}']);
  });
  it('повторный отзыв сливает поля', () => {
    const a = item('/api/games/3/review', '{"rating":8}', 'a');
    const b = item('/api/games/3/review', '{"note":"ок"}', 'b');
    const out = coalesce([a], b);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].body!)).toEqual({ rating: 8, note: 'ок' });
  });
});
