import { describe, expect, it } from 'vitest';
import type { PsnProfile } from '@/server/collection/types';
import { avatarInitial, clampPercent, levelBarPercent, levelProgressText, levelText, profileLine, trophyCells, usableProfile } from './model';

const full: PsnProfile = {
  onlineId: 'Artem_PS', avatarUrl: 'https://x/a.png', level: 312, levelProgress: 47, tier: 7,
  trophies: { platinum: 38, gold: 410, silver: 1100, bronze: 2800, total: 4348 },
};

describe('профиль PSN', () => {
  it('нет профиля или ника: блок скрыт', () => {
    expect(usableProfile(null)).toBeNull();
    expect(usableProfile(undefined)).toBeNull();
    expect(usableProfile({ ...full, onlineId: '  ' })).toBeNull();
    expect(usableProfile(full)).toBe(full);
  });
  it('уровень и прогресс до следующего', () => {
    expect(levelText(full)).toBe('Ур. 312');
    expect(levelProgressText(full)).toBe('47% до 313');
    expect(levelBarPercent(full)).toBe(47);
    expect(levelText({ level: null })).toBeNull();
    expect(levelProgressText({ level: 5, levelProgress: null })).toBeNull();
    expect(levelProgressText({ level: null, levelProgress: 10 })).toBeNull();
    expect(levelBarPercent({ level: 5, levelProgress: null })).toBeNull();
  });
  it('прогресс обрезается до 0..100', () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(46.6)).toBe(47);
  });
  it('строка меню: «Ур. 312 · 38 платин», части опускаются', () => {
    expect(profileLine(full)).toBe('Ур. 312 · 38 платин');
    expect(profileLine({ level: null, trophies: full.trophies })).toBe('38 платин');
    expect(profileLine({ level: 7, trophies: null })).toBe('Ур. 7');
    expect(profileLine({ level: null, trophies: null })).toBeNull();
    expect(profileLine({ level: 1, trophies: { ...full.trophies!, platinum: 1 } })).toBe('Ур. 1 · 1 платина');
    expect(profileLine({ level: 1, trophies: { ...full.trophies!, platinum: 22 } })).toBe('Ур. 1 · 22 платины');
  });
  it('счётчики трофеев аккаунта: четыре типа, разряды, «Всего»', () => {
    const c = trophyCells(full)!;
    expect(c.cells.map((x) => x.kind)).toEqual(['platinum', 'gold', 'silver', 'bronze']);
    expect(c.cells[0].aria).toBe('Платина 38');
    expect(c.cells[3].text).toBe('2\u00a0800');
    expect(c.total).toBe('Всего 4\u00a0348');
    expect(trophyCells({ trophies: null })).toBeNull();
  });
  it('инициал: первая буква ника или «?»', () => {
    expect(avatarInitial('artem_ps')).toBe('A');
    expect(avatarInitial(' жук')).toBe('Ж');
    expect(avatarInitial(null)).toBe('?');
    expect(avatarInitial('')).toBe('?');
  });
});
