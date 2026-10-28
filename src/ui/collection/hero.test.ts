import { describe, expect, it } from 'vitest';
import type { GameItem, GameTrophies } from '@/server/collection/types';
import { hasTrophyData, heroAriaLabel, heroFacts, heroLabel, heroLayout, heroProgress, miniMeta } from './hero';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const tr = (o: Partial<GameTrophies> = {}): GameTrophies => ({
  earned: 54, defined: 78, progress: 69, platinumDefined: true, platinumEarned: false,
  byType: { platinum: { earned: 0, defined: 1 }, gold: { earned: 0, defined: 0 }, silver: { earned: 0, defined: 0 }, bronze: { earned: 0, defined: 0 } }, ...o,
});
const game = (o: Partial<GameItem> = {}): GameItem => ({
  id: 1, title: 'Horizon', coverUrl: null, bannerUrl: null, platform: 'PS5', playSeconds: 128 * 3600 + 17 * 60, hours: 128.3, playCount: 3,
  lastPlayedAt: '2026-10-25T12:00:00.000Z', status: 'playing', completedAt: null, droppedAt: null, trophies: tr(), genres: [], hiddenAt: null, ...o,
});

describe('hero «Играю»', () => {
  it('метка: счётчик только при нескольких играх', () => {
    expect(heroLabel(1)).toBe('Играю');
    expect(heroLabel(7)).toBe('Играю 7');
  });
  it('раскладка: 1 игра, 2-4 игры, много игр (прокрутка боковой колонки)', () => {
    expect(heroLayout(1)).toEqual({ side: false, scrolls: false });
    expect(heroLayout(4)).toEqual({ side: true, scrolls: false });
    expect(heroLayout(5)).toEqual({ side: true, scrolls: true });
  });
  it('aria-label по спеке', () => {
    expect(heroAriaLabel(game())).toBe('Открыть: Horizon. Наиграно 128 ч, трофеи 54 из 78');
    expect(heroAriaLabel(game({ trophies: tr({ platinumEarned: true }) }))).toBe('Открыть: Horizon. Наиграно 128 ч, трофеи 54 из 78, платина получена');
    expect(heroAriaLabel(game({ trophies: null, playSeconds: 0 }))).toBe('Открыть: Horizon');
  });
  it('факты: значения, «нет данных», трофеи скрыты без списка', () => {
    const f = heroFacts(game(), NOW);
    expect(f.map((x) => x.id)).toEqual(['time', 'trophies', 'last']);
    expect(f[0].value).toBe('128 ч');
    expect(f[1].value).toBe('54/78');
    expect(f[2]).toMatchObject({ value: '3 дн. назад', title: '25 октября 2026 г.' });
    const none = heroFacts(game({ playSeconds: 0, lastPlayedAt: null, trophies: null }), NOW);
    expect(none.map((x) => x.id)).toEqual(['time', 'last']);
    expect(none[0]).toMatchObject({ value: 'нет данных', muted: true });
    expect(none[1]).toMatchObject({ value: 'нет данных', muted: true });
    expect(heroFacts(game({ trophies: tr({ defined: 0, earned: 0 }) }), NOW).map((x) => x.id)).toEqual(['time', 'last']);
  });
  it('прогресс: нет трофеев или defined = 0 = полоса скрыта', () => {
    expect(heroProgress(game())).toBe(69);
    expect(heroProgress(game({ trophies: null }))).toBeNull();
    expect(heroProgress(game({ trophies: tr({ defined: 0 }) }))).toBeNull();
    expect(heroProgress(game({ trophies: tr({ progress: 130 }) }))).toBe(100);
    expect(hasTrophyData(game({ trophies: null }))).toBe(false);
  });
  it('мета мини-карточки', () => {
    expect(miniMeta(game({ playSeconds: 28 * 3600 + 17 * 60 }), NOW)).toEqual({ time: '28 ч 17 м', ago: '3 дн. назад' });
    expect(miniMeta(game({ playSeconds: 0, lastPlayedAt: null }), NOW)).toEqual({ time: null, ago: null });
  });
});
