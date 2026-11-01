import { describe, expect, it } from 'vitest';
import {
  buildPutBody, filterLibrary, foundText, markCounts, markDate, markLabel, matchesFilter, normalizeQuery, removedText, sortLibrary, sortMarks,
  toastTitle, withoutRecent,
} from './owned-model';

const item = { externalId: '3328', title: 'Uncharted 3', coverUrl: null };

describe('owned-model', () => {
  it('поиск: регистр, ё/е, пробелы', () => {
    expect(normalizeQuery('  ЁЖик  Тест ')).toBe('ежик тест');
    const g = [{ id: 1, name: 'Ёжик в тумане' }, { id: 2, name: 'Uncharted: Nathan Drake Collection' }];
    expect(filterLibrary(g, 'ежик').map((x) => x.id)).toEqual([1]);
    expect(filterLibrary(g, 'NATHAN').map((x) => x.id)).toEqual([2]);
    expect(filterLibrary(g, '  ')).toHaveLength(2);
    expect(filterLibrary(g, 'zzz')).toEqual([]);
  });
  it('алфавит и недавние не дублируются', () => {
    const g = [{ id: 3, name: 'b' }, { id: 1, name: 'A' }, { id: 2, name: 'a' }];
    expect(sortLibrary(g).map((x) => x.id)).toEqual([1, 2, 3]);
    expect(withoutRecent(g, [1]).map((x) => x.id)).toEqual([3, 2]);
  });
  it('название в тосте до 40 символов', () => {
    expect(toastTitle('Short')).toBe('Short');
    const long = 'x'.repeat(60);
    expect(Array.from(toastTitle(long))).toHaveLength(40);
    expect(toastTitle(long).endsWith('…')).toBe(true);
    expect(removedText('Uncharted 3')).toBe('Убрано из подборки: «Uncharted 3»');
  });
  it('тело PUT: поля по виду отметки', () => {
    expect(buildPutBody(item, 'covered', 123, true)).toEqual({
      externalSource: 'rawg', externalId: '3328', title: 'Uncharted 3', coverUrl: null, kind: 'covered', coveredByGameId: 123,
    });
    expect(buildPutBody(item, 'covered', null, false)).toBeNull();
    const none = buildPutBody(item, 'none', 5, true);
    expect(none).toEqual({ externalSource: 'rawg', externalId: '3328', title: 'Uncharted 3', coverUrl: null, kind: 'not_in_library', completed: true });
    expect(none).not.toHaveProperty('coveredByGameId');
  });
  it('подпись, фильтры, счётчики', () => {
    const covered = { kind: 'covered', completed: false, coveredBy: { gameId: 1, name: 'NDC', imageUrl: null } } as const;
    const out = { kind: 'not_in_library', completed: true, coveredBy: null } as const;
    expect(markLabel(covered)).toBe('Входит в «NDC»');
    expect(markLabel(out)).toBe('Нет в библиотеке · Прошёл');
    expect(markLabel({ kind: 'not_in_library', completed: false, coveredBy: null })).toBe('Нет в библиотеке');
    expect(matchesFilter(covered, 'covered')).toBe(true);
    expect(matchesFilter(out, 'completed')).toBe(true);
    expect(matchesFilter(out, 'covered')).toBe(false);
    expect(markCounts([covered, out, out])).toEqual({ all: 3, covered: 1, completed: 2 });
  });
  it('сортировка по дате и дата по Москве', () => {
    const l = [{ externalId: 'a', updatedAt: '2026-11-01T10:00:00Z' }, { externalId: 'b', updatedAt: '2026-11-03T10:00:00Z' }];
    expect(sortMarks(l).map((x) => x.externalId)).toEqual(['b', 'a']);
    expect(markDate('2026-11-03T21:30:00Z')).toBe('4 нояб.');
    expect(markDate('bad')).toBeNull();
  });
  it('склонение «Найдено N игр»', () => {
    expect(foundText(1)).toBe('Найдено 1 игра');
    expect(foundText(3)).toBe('Найдено 3 игры');
    expect(foundText(11)).toBe('Найдено 11 игр');
    expect(foundText(0)).toBe('Найдено 0 игр');
  });
});
