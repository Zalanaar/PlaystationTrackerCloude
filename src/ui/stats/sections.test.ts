import { describe, expect, it } from 'vitest';
import { currentSection, STATS_SECTIONS } from './sections';

describe('D-P5: текущий раздел', () => {
  const tops = [{ id: 'hours', top: 300 }, { id: 'top', top: 900 }, { id: 'rare', top: 1500 }];
  it('выше первого — первый; дальше последний пересёкший линию', () => {
    expect(currentSection(tops, 120, false)).toBe('hours');
    expect(currentSection(tops.map((t) => ({ ...t, top: t.top - 850 })), 120, false)).toBe('top');
  });
  it('внизу страницы — последний', () => expect(currentSection(tops, 120, true)).toBe('rare'));
  it('пусто — null', () => expect(currentSection([], 120, false)).toBeNull());
  it('ids уникальны', () => expect(new Set(STATS_SECTIONS.map((s) => s.id)).size).toBe(STATS_SECTIONS.length));
});
