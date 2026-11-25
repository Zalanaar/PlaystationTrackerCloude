import { describe, expect, it } from 'vitest';
import { backlogLinkLabel, isHomeBacklogRow } from './BacklogLinkRow';

const home = { status: 'all' as const, q: '', platinum: false, platform: null, hidden: false, tag: null };

describe('backlogLinkLabel', () => {
  it('собирает только ненулевые счётчики в порядке Бэклог · Отложено · Сервис', () => {
    expect(backlogLinkLabel({ backlog: 34, shelved: 5, service: 4 })).toBe('Бэклог 34 · Отложено 5 · Сервис 4');
    expect(backlogLinkLabel({ backlog: 1, shelved: 1, service: 0 })).toBe('Бэклог 1 · Отложено 1');
    expect(backlogLinkLabel({ backlog: 0, shelved: 0, service: 9 })).toBe('Сервис 9');
    expect(backlogLinkLabel({ backlog: 0, shelved: 0, service: 0 })).toBeNull();
  });
});

describe('isHomeBacklogRow', () => {
  it('только чистая главная (все, без поиска и фильтров)', () => {
    expect(isHomeBacklogRow(home)).toBe(true);
    expect(isHomeBacklogRow({ ...home, status: 'backlog' })).toBe(false);
    expect(isHomeBacklogRow({ ...home, q: 'Stray' })).toBe(false);
    expect(isHomeBacklogRow({ ...home, platinum: true })).toBe(false);
    expect(isHomeBacklogRow({ ...home, platform: 'ps5' })).toBe(false);
    expect(isHomeBacklogRow({ ...home, hidden: true })).toBe(false);
    expect(isHomeBacklogRow({ ...home, tag: 1 })).toBe(false);
  });
});
