import { describe, expect, it } from 'vitest';
import { checklistItems, daysLeft, progressText } from './model';

const base = { sync: true, statuses: { count: 2, goal: 5, done: false }, hltb: false, monthGoals: false };

describe('П13.4: пункты «Первой недели»', () => {
  it('порядок, подписи, PWA только когда доступна или сделана', () => {
    const l = checklistItems(base, { themeChosen: true, pwaInstalled: false, pwaAvailable: false });
    expect(l.map((i) => i.id)).toEqual(['sync', 'statuses', 'hltb', 'theme', 'monthGoals']);
    expect(l[1].label).toBe('Расставь статусы · 2 из 5');
    expect(progressText(l)).toBe('2 из 5');
    expect(checklistItems(base, { themeChosen: false, pwaInstalled: false, pwaAvailable: true }).map((i) => i.id)).toContain('pwa');
    expect(checklistItems({ ...base, statuses: { count: 9, goal: 5, done: true } }, { themeChosen: false, pwaInstalled: true, pwaAvailable: false })[1].label).toBe('Статусы расставлены');
  });
  it('дней осталось', () => {
    const now = Date.parse('2026-11-10T09:00:00Z');
    expect(daysLeft('2026-11-17T09:00:00Z', now)).toBe(7);
    expect(daysLeft('2026-11-10T10:00:00Z', now)).toBe(1);
    expect(daysLeft(null, now)).toBe(0);
  });
});
