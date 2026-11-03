import { describe, expect, it } from 'vitest';
import { headerActionsFor } from './headerActions';

describe('headerActionsFor', () => {
  it('поиск на Коллекции и Бэклоге, «+» только на Бэклоге', () => {
    expect(headerActionsFor('/')).toEqual({ search: true, add: false });
    expect(headerActionsFor('/backlog')).toEqual({ search: true, add: true });
    expect(headerActionsFor('/backlog/')).toEqual({ search: true, add: true });
    expect(headerActionsFor('/roadmap')).toEqual({ search: false, add: false });
    expect(headerActionsFor('/stats')).toEqual({ search: false, add: false });
  });
});
