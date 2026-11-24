import { describe, expect, it } from 'vitest';
import { currentSection, resolveStatsSec, STATS_SECTIONS } from './sections';

describe('D-P5: текущий раздел', () => {
  const tops = [{ id: 'time', top: 300 }, { id: 'games', top: 900 }, { id: 'trophies', top: 1500 }];
  it('выше первого — первый; дальше последний пересёкший линию', () => {
    expect(currentSection(tops, 120, false)).toBe('time');
    expect(currentSection(tops.map((t) => ({ ...t, top: t.top - 850 })), 120, false)).toBe('games');
  });
  it('внизу страницы — последний', () => expect(currentSection(tops, 120, true)).toBe('trophies'));
  it('пусто — null', () => expect(currentSection([], 120, false)).toBeNull());
  it('ids уникальны, стоимость часа убрана', () => {
    expect(new Set(STATS_SECTIONS.map((s) => s.id)).size).toBe(STATS_SECTIONS.length);
    expect(STATS_SECTIONS.map((s) => s.id)).toEqual(['time', 'games', 'trophies', 'ratings', 'activity']);
  });
  it('старые ?sec= ведут в группу', () => {
    expect(resolveStatsSec('cost')?.group).toBe('time');
    expect(resolveStatsSec('hours')?.group).toBe('time');
    expect(resolveStatsSec('ach')?.group).toBe('trophies');
    expect(resolveStatsSec('ratings')?.group).toBe('ratings');
    expect(resolveStatsSec('нет') ).toBeNull();
  });
});
