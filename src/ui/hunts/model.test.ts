import { describe, expect, it } from 'vitest';
import { gameProgressLine, hasHunt, huntKey, huntingGame, huntingTrophy, trophyName } from './model';
import type { HuntGame, HuntsView } from '@/shared/hunts';

const g: HuntGame = { id: 3, title: 'Hades', coverUrl: null, earned: 5, defined: 20, remaining: 15, progress: 25, platEarned: false };
const view = (o: Partial<HuntsView> = {}): HuntsView => ({ game: null, trophies: [], ...o });

describe('тексты и ключи охоты', () => {
  it('прогресс, имя, наличие', () => {
    expect(gameProgressLine(g)).toBe('5 из 20 · осталось 15 трофеев');
    expect(gameProgressLine({ ...g, remaining: 1 })).toContain('1 трофей');
    expect(trophyName({ gameId: 1, setId: 1, trophyId: 2, gameTitle: 'A', coverUrl: null, name: null, iconUrl: null, type: 'bronze', hidden: true, earned: false })).toBe('Скрытый трофей');
    expect(hasHunt(view())).toBe(false);
    expect(hasHunt(view({ game: g }))).toBe(true);
    expect(huntKey({ setId: 4, trophyId: 0 })).toBe('4:0');
    expect(huntingGame(view({ game: g }), 3)).toBe(true);
    expect(huntingTrophy(view({ trophies: [{ gameId: 1, setId: 2, trophyId: 5, gameTitle: 'A', coverUrl: null, name: 'T', iconUrl: null, type: 'bronze', hidden: false, earned: false }] }), 2, 5)).toBe(true);
  });
});
