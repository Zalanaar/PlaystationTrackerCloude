import { describe, expect, it } from 'vitest';
import { headerActionsFor } from './headerActions';

describe('headerActionsFor', () => {
  it('поиск на Коллекции и Бэклоге; «+» на Бэклоге — магазин PS, на Коллекции — другая платформа', () => {
    const store = { action: 'add', label: 'Добавить из магазина PS' };
    const other = { action: 'add-other', label: 'Добавить игру с другой платформы' };
    expect(headerActionsFor('/')).toEqual({ search: true, add: other });
    expect(headerActionsFor('/backlog')).toEqual({ search: true, add: store });
    expect(headerActionsFor('/backlog/')).toEqual({ search: true, add: store });
    expect(headerActionsFor('/roadmap')).toEqual({ search: false, add: null });
    expect(headerActionsFor('/stats')).toEqual({ search: false, add: null });
  });
});
