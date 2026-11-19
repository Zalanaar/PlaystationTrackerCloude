import { describe, expect, it } from 'vitest';
import type { LevelResponse } from '@/server/trophies/level-query';
import { levelEta, levelGrade, levelMeta, levelNextText, monthYear, shortDate } from './level';

const base: LevelResponse = { level: 312, progress: 47, tier: 4, points: 75000, toNext: 477, gained: { d30: { points: 900, levels: 1 }, d365: { points: 12000, levels: 13 } }, eta: { next: '2026-12-14', milestone: { level: 400, date: '2028-03-02' } }, approximate: false };

describe('П12.3 подписи уровня', () => {
  it('ступень цвета', () => {
    expect([levelGrade(5), levelGrade(100), levelGrade(299), levelGrade(300), levelGrade(999)]).toEqual(['bronze', 'silver', 'silver', 'gold', 'platinum']);
  });
  it('до следующего уровня: справа только процент', () => {
    expect(levelNextText(base)).toBe('47%');
    expect(levelNextText({ ...base, progress: null })).toBeNull();
    expect(levelNextText({ ...base, level: 999 })).toBe('Максимальный уровень');
    expect(levelNextText({ ...base, level: null })).toBeNull();
  });
  it('F21 строка 1: очки и дата следующего уровня', () => {
    expect(levelEta(base, '2026-11-17')).toBe('До 313: 477 очков, ≈ 14 дек.');
    expect(levelEta({ ...base, approximate: true, toNext: 1 }, '2026-11-17')).toBe('До 313: ≈ 1 очко, ≈ 14 дек.');
    expect(levelEta({ ...base, eta: null }, '2026-11-17')).toBe('До 313: 477 очков, прогноза нет: за 90 дней трофеев нет');
    expect(levelEta({ ...base, toNext: null, eta: null, gained: null }, '2026-11-17')).toBeNull();
    expect(levelEta({ ...base, level: 999 }, '2026-11-17')).toBeNull();
  });
  it('даты', () => {
    expect(shortDate('2026-12-14', '2026-11-17')).toBe('14 дек.');
    expect(shortDate('2027-01-02', '2026-11-17')).toBe('2 янв. 2027');
    expect(monthYear('2028-03-02', '2026-11-17')).toBe('март 2028');
  });
  it('F21 строка 2: прирост и дальний рубеж', () => {
    expect(levelMeta(base, '2026-11-17')).toBe('За год +13 уровней · за 30 дней +1 · 400 ≈ март 2028');
    expect(levelMeta({ ...base, gained: { d30: { points: 0, levels: 0 }, d365: { points: 0, levels: 0 } }, eta: null }, '2026-11-17')).toBe('За год без нового уровня · за 30 дней 0');
    expect(levelMeta({ ...base, eta: { next: '2026-12-14', milestone: { level: 400, date: null } } }, '2026-11-17')).toBe('За год +13 уровней · за 30 дней +1');
    expect(levelMeta({ ...base, gained: null, eta: null }, '2026-11-17')).toBeNull();
  });
});
