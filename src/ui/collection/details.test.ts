import { describe, expect, it } from 'vitest';
import type { GameItem, GameTrophies } from '@/server/collection/types';
import { artMode, detailSubtitle, detailTabs, detailTiles, lastPlayedText, nextTab } from './details';

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
    expect(t.launches).toMatchObject({ value: '19', sub: 'посл. 3 дн. назад' });
    expect(t.trophies).toMatchObject({ value: '54/78', sub: '69%', progress: 69 });
  });
  it('нулевые часы и запуски: «нет данных», без подписи', () => {
    const t = by(game({ playSeconds: 0, playCount: 0, lastPlayedAt: null, trophies: null }));
    expect(t.hours).toMatchObject({ value: 'нет данных', muted: true, sub: '' });
    expect(t.launches).toMatchObject({ value: 'нет данных', muted: true, sub: '' });
    expect(t.trophies).toMatchObject({ value: 'нет данных', progress: null });
    expect(t.trophies).toMatchObject({ plat: { state: 'unknown', text: '' } });
    expect(Object.keys(t)).toEqual(['hours', 'launches', 'trophies']);
  });
  it('запуски без даты последнего запуска', () => {
    expect(by(game({ lastPlayedAt: null })).launches).toMatchObject({ value: '19', sub: 'посл. запуск неизвестен' });
  });
  it('D-P4: платина строкой в ячейке трофеев: получена с датой и без неё, не получена, нет в игре', () => {
    const plat = (g: GameItem, at: string | null = null) => (by(g, at).trophies as Extract<ReturnType<typeof detailTiles>[number], { id: 'trophies' }>).plat;
    expect(plat(game({ trophies: tr({ platinumEarned: true }) }), '2026-10-05T18:42:11.000Z')).toEqual({ state: 'earned', text: 'платина 5 окт. 2026' });
    expect(plat(game({ trophies: tr({ platinumEarned: true }) }))).toEqual({ state: 'earned', text: 'платина получена' });
    expect(plat(game())).toEqual({ state: 'locked', text: 'платина не получена' });
    expect(plat(game({ trophies: tr({ platinumDefined: false }) }))).toEqual({ state: 'none', text: 'без платины' });
  });
  it('нет списка трофеев (defined = 0): плитка «нет данных»', () => {
    expect(by(game({ trophies: tr({ defined: 0, earned: 0, progress: 0 }) })).trophies).toMatchObject({ value: 'нет данных', progress: null });
  });
  it('подзаголовок и последний запуск', () => {
    expect(detailSubtitle(game())).toBe('PlayStation · PS5 · Экшен, Приключения');
    expect(detailSubtitle(game({ genres: [], platform: 'PS4' }))).toBe('PlayStation · PS4');
    expect(lastPlayedText('2026-10-25T12:00:00.000Z', NOW)).toBe('25 окт. 2026 · 3 дн. назад');
    expect(lastPlayedText(null, NOW)).toBe('нет данных');
  });
  it('режим арта: баннер, размытая обложка, ничего', () => {
    expect(artMode(true, true)).toBe('banner');
    expect(artMode(true, false)).toBe('banner');
    expect(artMode(false, true)).toBe('blur');
    expect(artMode(false, false)).toBe('none');
  });
  it('вкладки: стрелки по кругу, Home и End', () => {
    expect(nextTab('overview', 'ArrowRight')).toBe('trophies');
    expect(nextTab('trophies', 'ArrowRight')).toBe('guides');
    expect(nextTab('guides', 'ArrowRight')).toBe('overview');
    expect(nextTab('overview', 'ArrowLeft')).toBe('guides');
    expect(nextTab('guides', 'Home')).toBe('overview');
    expect(nextTab('overview', 'End')).toBe('guides');
    expect(nextTab('overview', 'Enter')).toBeNull();
  });
  it('F2-A: у сервиса вкладки «Гайды» нет, стрелки ходят по двум', () => {
    const svc = detailTabs(game({ status: 'service' }));
    expect(svc.map((x) => x.id)).toEqual(['overview', 'trophies']);
    expect(detailTabs(game()).map((x) => x.id)).toEqual(['overview', 'trophies', 'guides']);
    expect(nextTab('trophies', 'ArrowRight', svc)).toBe('overview');
    expect(nextTab('overview', 'End', svc)).toBe('trophies');
  });
});
