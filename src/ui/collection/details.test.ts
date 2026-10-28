import { describe, expect, it } from 'vitest';
import type { GameItem, GameTrophies } from '@/server/collection/types';
import { detailSubtitle, detailTiles, lastPlayedText, nextTab } from './details';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const tr = (o: Partial<GameTrophies> = {}): GameTrophies => ({
  earned: 54, defined: 78, progress: 69, platinumDefined: true, platinumEarned: false,
  byType: { platinum: { earned: 0, defined: 1 }, gold: { earned: 0, defined: 0 }, silver: { earned: 0, defined: 0 }, bronze: { earned: 0, defined: 0 } }, ...o,
});
const game = (o: Partial<GameItem> = {}): GameItem => ({
  id: 1, title: 'X', coverUrl: null, bannerUrl: null, platform: 'PS5', playSeconds: 128 * 3600 + 17 * 60, hours: 128.3, playCount: 19,
  lastPlayedAt: '2026-10-25T12:00:00.000Z', status: 'playing', completedAt: null, droppedAt: null, trophies: tr(), genres: [{ key: 'ACTION', label: 'Экшен' }, { key: 'ADVENTURE', label: 'Приключения' }],
  hiddenAt: null, ...o,
});
const by = (g: GameItem, at: string | null = null) => Object.fromEntries(detailTiles(g, NOW, at).map((t) => [t.id, t]));

describe('плитки окна игры', () => {
  it('часы, запуски, трофеи', () => {
    const t = by(game());
    expect(t.hours).toMatchObject({ value: '128 ч', sub: 'наиграно', muted: false });
    expect(t.launches).toMatchObject({ value: '19 запусков', sub: 'последний 3 дн. назад' });
    expect(t.trophies).toMatchObject({ value: '54/78', sub: '69%', progress: 69 });
  });
  it('нулевые часы и запуски: «нет данных», без подписи', () => {
    const t = by(game({ playSeconds: 0, playCount: 0, lastPlayedAt: null, trophies: null }));
    expect(t.hours).toMatchObject({ value: 'нет данных', muted: true, sub: '' });
    expect(t.launches).toMatchObject({ value: 'нет данных', muted: true, sub: '' });
    expect(t.trophies).toMatchObject({ value: 'нет данных', progress: null });
    expect(t.platinum).toMatchObject({ value: 'нет данных', state: 'unknown' });
  });
  it('платина: получена с датой и без неё, не получена, нет в игре', () => {
    expect(by(game({ trophies: tr({ platinumEarned: true }) }), '2026-10-05T18:42:11.000Z').platinum).toMatchObject({ value: 'Получена', sub: '5 окт. 2026', state: 'earned', muted: false });
    expect(by(game({ trophies: tr({ platinumEarned: true }) })).platinum).toMatchObject({ value: 'Получена', sub: '' });
    expect(by(game()).platinum).toMatchObject({ value: 'Нет', sub: 'не получена', state: 'locked' });
    expect(by(game({ trophies: tr({ platinumDefined: false }) })).platinum).toMatchObject({ sub: 'в игре нет платины' });
  });
  it('нет списка трофеев (defined = 0): плитка «нет данных»', () => {
    expect(by(game({ trophies: tr({ defined: 0, earned: 0, progress: 0 }) })).trophies).toMatchObject({ value: 'нет данных', progress: null });
  });
  it('подзаголовок и последний запуск', () => {
    expect(detailSubtitle(game())).toBe('PlayStation · PS5 · Экшен, Приключения');
    expect(detailSubtitle(game({ genres: [], platform: 'PS4' }))).toBe('PlayStation · PS4');
    expect(lastPlayedText('2026-10-25T12:00:00.000Z', NOW)).toBe('25 октября 2026 г. (3 дн. назад)');
    expect(lastPlayedText(null, NOW)).toBe('нет данных');
  });
  it('вкладки: стрелки по кругу, Home и End', () => {
    expect(nextTab('overview', 'ArrowRight')).toBe('trophies');
    expect(nextTab('trophies', 'ArrowRight')).toBe('overview');
    expect(nextTab('overview', 'ArrowLeft')).toBe('trophies');
    expect(nextTab('trophies', 'Home')).toBe('overview');
    expect(nextTab('overview', 'End')).toBe('trophies');
    expect(nextTab('overview', 'Enter')).toBeNull();
  });
});
