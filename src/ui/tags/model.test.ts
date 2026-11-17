import { describe, expect, it } from 'vitest';
import { cleanName, gamesCount, nameValid, plural, sortTags, tagHref } from './model';

describe('П13.2 теги: чистая часть', () => {
  it('склонение', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, ['игра', 'игры', 'игр']))).toEqual(['игра', 'игры', 'игр', 'игр', 'игра', 'игры', 'игр', 'игр']);
    expect(gamesCount(3)).toBe('3 игры');
  });
  it('имя и ссылка', () => {
    expect(cleanName('  a   b ')).toBe('a b');
    expect(nameValid('   ')).toBe(false);
    expect(nameValid('я'.repeat(33))).toBe(false);
    expect(tagHref(5)).toBe('/?tag=5');
  });
  it('порядок без учёта регистра', () => {
    expect(sortTags([{ id: 2, name: 'б', count: 0 }, { id: 1, name: 'А', count: 0 }]).map((t) => t.id)).toEqual([1, 2]);
  });
});
