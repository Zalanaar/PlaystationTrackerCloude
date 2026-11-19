import { describe, expect, it } from 'vitest';
import type { WrappedResponse } from '@/server/wrapped/types';
import { ART_OPACITY, bigNumberCqw, SLIDE_COLORS, slideColor, slideMosaic, STORY_SHADE, summaryTiles, TINT_ALPHA, yearSummary } from './look';

// контраст: та же формула, что в src/ui/tokens/contrast.test.ts
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg: number[], a: number, bg: number[]) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const W = [255, 255, 255];

describe('цвет слайда (П8.2)', () => {
  it('у каждого слайда свой цвет, соседние слайды различаются', () => {
    expect(slideColor('hours')).not.toBe(slideColor('topGames'));
    expect(new Set(Object.values(SLIDE_COLORS)).size).toBeGreaterThanOrEqual(12);
  });
  // худший случай: белая обложка (арт .7) поверх самой светлой сцены (тон слайда 40% на --surface-3 PS4), тон слайда смешан с белым акцентом (20%),
  // сверху тон .55 и затемнение .55. Белый текст и приглушённый (.7 белого) >= 4.5
  for (const [id, hex] of Object.entries(SLIDE_COLORS)) {
    it(`${id}: белый и приглушённый текст >= 4.5 на белой обложке`, () => {
      const c = over(rgb(hex), 0.8, W);
      const stage = over(c, 0.4, rgb('#164090'));
      const art = over(W, ART_OPACITY, stage);
      const tinted = over(c, TINT_ALPHA, art);
      const bg = over([0, 0, 0], STORY_SHADE, tinted);
      expect(ratio(W, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(over(W, 0.7, bg), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

const g = (id: number, cover: string | null) => ({ id, title: `Игра ${id}`, coverUrl: cover }) as never;
const base = (o: Partial<WrappedResponse> = {}): WrappedResponse => ({
  year: 2026, mode: 'story', scope: 'year', period: { from: null, to: null, fromUtc: null, toUtc: null }, years: [], profile: { onlineId: 'Artem_PS', avatarUrl: null },
  firstSnapshotDate: null, periodPartial: false, slides: [],
  hours: { hasData: true, total: 412.4, days: 17, byMonth: [], estimatedByMonth: [], estimatedHours: 0, hasEstimate: false, topMonth: null },
  topGames: { hasData: true, items: [1, 2, 3, 4].map((r) => ({ rank: r, seconds: 1, hours: 40 - r, estimated: r === 2, game: g(r, r === 3 ? null : `https://c/${r}.png`) })) },
  finished: { hasData: true, completed: { count: 12, items: [{ at: '', game: g(1, 'https://c/1.png') }, { at: '', game: g(9, 'https://c/9.png') }] }, dropped: { count: 1, items: [] }, busiestMonth: null },
  trophies: { hasData: true, counts: { platinum: 7, gold: 1, silver: 1, bronze: 1, total: 366 }, platinum: { first: null, last: null, rarest: null }, rare: [] },
  genres: { hasData: false, items: [] },
  longestGame: { hasData: true, seconds: 1, hours: 1, estimated: false, playCount: 1, game: g(5, 'https://c/5.png') },
  emptyState: null,
  ...o,
}) as WrappedResponse;

describe('мозаика фона', () => {
  it('слайд со своей обложкой — без мозаики; без неё — до 4 разных обложек, пустые пропущены', () => {
    expect(slideMosaic('hours', base())).toEqual([]);
    expect(slideMosaic('start', base())).toEqual(['https://c/1.png', 'https://c/2.png', 'https://c/4.png', 'https://c/9.png']);
    expect(slideMosaic('genres', base({ topGames: { hasData: false, items: [] }, finished: { hasData: false, completed: { count: 0, items: [] }, dropped: { count: 0, items: [] }, busiestMonth: null }, longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null } }))).toEqual([]);
  });
});

describe('крупные числа', () => {
  it('чем длиннее строка, тем меньше; «2 840,5» помещается (17cqw * 6 знаков < 100cqw)', () => {
    expect(bigNumberCqw('7')).toBeGreaterThan(bigNumberCqw('366'));
    expect(bigNumberCqw('366')).toBeGreaterThan(bigNumberCqw('412,4'));
    expect(bigNumberCqw('2 840,5') * 6 * 0.75).toBeLessThan(100);
  });
});

describe('сводка года', () => {
  it('часы, пройдено, платины, трофеи, топ-3; игра года = лучшая по оценке, иначе первая по часам', () => {
    const s = yearSummary(base());
    expect(s).toMatchObject({ scope: 'year', year: 2026, hours: 412.4, completed: 12, platinums: 7, trophies: 366, nick: 'Artem_PS' });
    expect(s.top3.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(s.gameOfYear).toMatchObject({ id: 1, reason: 'hours', rating: null });
    const r = yearSummary(base({ bestGame: { hasData: true, rating: 9, hours: 12, estimated: false, game: g(7, null) } }));
    expect(r.gameOfYear).toMatchObject({ id: 7, reason: 'rating', rating: 9 });
    expect(summaryTiles(s).map((t) => `${t.value} ${t.label}`)).toEqual(['412 ч в играх', '12 игр пройдено', '7 платин', '366 трофеев']);
  });
  it('без часов плитки часов нет; оценка без игры не считается; «всё время» берёт платины по годам', () => {
    const s = yearSummary(base({ hours: { ...base().hours, total: null }, bestGame: { hasData: false, rating: null, hours: 0, estimated: false, game: null } }));
    expect(summaryTiles(s).map((t) => t.key)).toEqual(['completed', 'platinums', 'trophies']);
    expect(s.gameOfYear?.reason).toBe('hours');
    const a = yearSummary(base({ scope: 'all', allTime: { platinumByYear: { hasData: true, total: 35, items: [] } } as never }));
    expect(a).toMatchObject({ scope: 'all', platinums: 35 });
    expect(summaryTiles(yearSummary(base({ trophies: { ...base().trophies, counts: { platinum: 1, gold: 0, silver: 0, bronze: 0, total: 21 } } }))).map((t) => t.label)).toEqual(['ч в играх', 'игр пройдено', 'платина', 'трофей']);
  });
});
