import { describe, expect, it } from 'vitest';
import { firstNextGame, listNextGames, planMonthHoursHint } from './next-game';

const plan = (o: Record<string, unknown>) => ({ kind: 'backlog', gameId: 1, title: 'A', coverUrl: null, hours: 10, ...o });

describe('planMonthHoursHint', () => {
  it('ноябрь 30 дней, 10 ч/нед → 43; пустые и нулевые — null', () => {
    expect(planMonthHoursHint(10, 2026, 11)).toBe(43);
    expect(planMonthHoursHint(10, 2026, 2)).toBe(40);
    expect(planMonthHoursHint(null, 2026, 11)).toBeNull();
    expect(planMonthHoursHint(0, 2026, 11)).toBeNull();
  });
});

describe('listNextGames', () => {
  it('сначала незакрытые цели месяца, затем очередь Плана; релизы и пройденные пропускает', () => {
    const items = [
      plan({ kind: 'release', gameId: null, title: 'R' }),
      plan({ gameId: 7, title: 'PlanFirst', hours: 8 }),
      plan({ gameId: 8, title: 'Next', hours: 12.5 }),
    ];
    const goals = [
      { id: 8, title: 'Next', coverUrl: null, completed: false },
      { id: 9, title: 'DoneGoal', coverUrl: null, completed: true },
      { id: 3, title: 'GoalOnly', coverUrl: 'c', completed: false },
    ];
    expect(listNextGames(items, goals, 99).map((x) => [x.gameId, x.source, x.hours])).toEqual([
      [8, 'month_goal', 12.5],
      [3, 'month_goal', null],
      [7, 'plan', 8],
    ]);
    expect(firstNextGame(items, goals, 8)?.gameId).toBe(3);
  });

  it('без целей — как очередь Плана; пусто — пустой список', () => {
    const items = [plan({ gameId: 7, title: 'Done' }), plan({ gameId: 8, title: 'Next', hours: 12.5 })];
    expect(firstNextGame(items, [], 7)).toEqual({ gameId: 8, title: 'Next', coverUrl: null, hours: 12.5, source: 'plan' });
    expect(firstNextGame([], [], 1)).toBeNull();
    expect(firstNextGame(null, null, 1)).toBeNull();
  });
});
