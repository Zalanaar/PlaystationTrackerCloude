import { describe, expect, it } from 'vitest';
import type { OtherPlatformGame } from './api';
import { addErrorText, addedDateText, addedToastText, filterOther, mergeOther, removedToastText, sortOther } from './model';

const g = (id: number, title: string, createdAt = '2026-11-03T10:00:00.000Z'): OtherPlatformGame => ({
  id, source: 'manual', kind: 'other_platform', externalSource: 'rawg', externalId: String(id), title, coverUrl: null, releaseDate: null, platformLabel: null, createdAt, status: null, statusChangedAt: null, rating: null, note: null,
});

describe('other-platforms model', () => {
  it('сортировка: createdAt убыв., затем id убыв.', () => {
    const r = sortOther([g(1, 'a', '2026-11-01T00:00:00.000Z'), g(2, 'b', '2026-11-03T00:00:00.000Z'), g(3, 'c', '2026-11-03T00:00:00.000Z')]);
    expect(r.map((x) => x.id)).toEqual([3, 2, 1]);
  });
  it('фильтр без регистра и ё/е', () => {
    const items = [g(1, 'Ёжик Соник'), g(2, 'Halo')];
    expect(filterOther(items, 'ежик').map((x) => x.id)).toEqual([1]);
    expect(filterOther(items, 'HALO').map((x) => x.id)).toEqual([2]);
    expect(filterOther(items, '  ')).toHaveLength(2);
  });
  it('merge: повтор по id заменяется, новые наверху', () => {
    const r = mergeOther([g(1, 'a', '2026-11-01T00:00:00.000Z')], [g(2, 'b', '2026-11-05T00:00:00.000Z'), g(1, 'a2', '2026-11-04T00:00:00.000Z')]);
    expect(r.map((x) => x.title)).toEqual(['b', 'a2']);
  });
  it('тексты', () => {
    expect(addedDateText('2026-11-03T10:00:00.000Z')).toBe('Добавлено 3 нояб. 2026');
    expect(removedToastText('X'.repeat(60))).toBe(`Убрано из списка: «${'X'.repeat(39)}…»`);
    expect(addedToastText(['A'])).toBe('Добавлено в список: «A»');
    expect(addedToastText(['A', 'B'])).toBe('Добавлено в список: 2');
  });
  it('ошибка добавления: лимит берётся из ответа', () => {
    expect(addErrorText({ status: 409, code: 'manual_limit', details: { limit: 300 } })).toBe('Список заполнен: максимум 300 игр. Убери лишние.');
    expect(addErrorText(new Error('x'))).toBe('Не удалось добавить. Повтори.');
  });
});
