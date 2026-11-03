import { describe, expect, it } from 'vitest';
import { guideLinks, guideQuery } from './guides';

describe('F2-A: поиск гайдов', () => {
  it('нормализация названия', () => {
    expect(guideQuery('LEGO® Batman™: Legacy of the Dark Knight')).toBe('LEGO Batman Legacy of the Dark Knight');
    expect(guideQuery('Grand Theft Auto V (PlayStation®5)')).toBe('Grand Theft Auto V');
    expect(guideQuery('Marvel’s Wolverine')).toBe("Marvel's Wolverine");
    expect(guideQuery('Hogwarts Legacy PS4 & PS5')).toBe('Hogwarts Legacy');
    expect(guideQuery('Stray - PS5')).toBe('Stray');
    expect(guideQuery('Call of Duty®: Modern Warfare® II')).toBe('Call of Duty Modern Warfare II');
    expect(guideQuery('Horizon Forbidden West')).toBe('Horizon Forbidden West');
    expect(guideQuery('™')).toBe('™');
  });
  it('ссылки: PowerPyx ?s=…+trophy+guide и PSNProfiles search/guides?q=…', () => {
    const [pp, psn] = guideLinks('Elden Ring®');
    expect(pp.href).toBe('https://www.powerpyx.com/?s=Elden+Ring+trophy+guide');
    expect(psn.href).toBe('https://psnprofiles.com/search/guides?q=Elden+Ring');
    expect(guideLinks('A & B?')[0].href).toBe('https://www.powerpyx.com/?s=A+%26+B%3F+trophy+guide');
  });
});
