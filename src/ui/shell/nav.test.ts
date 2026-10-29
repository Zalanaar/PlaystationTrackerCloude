import { describe, expect, it } from 'vitest';
import { NAV_TABS } from '../tokens';
import { isSubnavActive, isTabActive } from './nav';

const active = (path: string) => NAV_TABS.filter((t) => isTabActive(path, t)).map((t) => t.id);

describe('isTabActive', () => {
  it('Коллекция только на корне', () => {
    expect(active('/')).toEqual(['collection']);
    expect(active('/stats')).toEqual(['stats']);
  });
  it('Бэклог держит /roadmap и /recommend', () => {
    expect(active('/backlog')).toEqual(['backlog']);
    expect(active('/roadmap')).toEqual(['backlog']);
    expect(active('/recommend')).toEqual(['backlog']);
    expect(active('/recommend/x')).toEqual(['backlog']);
  });
  it('Статистика держит /wrapped, Разбор отдельно', () => {
    expect(active('/wrapped')).toEqual(['stats']);
    expect(active('/triage')).toEqual(['triage']);
    expect(active('/backlogs')).toEqual([]);
  });
  it('завершающий слэш не мешает', () => {
    expect(active('/stats/')).toEqual(['stats']);
  });
});

describe('isSubnavActive', () => {
  it('точное совпадение и вложенные', () => {
    expect(isSubnavActive('/roadmap', '/roadmap')).toBe(true);
    expect(isSubnavActive('/roadmap/x', '/roadmap')).toBe(true);
    expect(isSubnavActive('/backlog', '/roadmap')).toBe(false);
  });
});
