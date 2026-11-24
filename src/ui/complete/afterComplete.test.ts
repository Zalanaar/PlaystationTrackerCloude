import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceCompleted, COMPLETED_EVENT, nextFromPlan } from './afterComplete';

const entry = (o: Record<string, unknown>) => ({ key: 'x', kind: 'backlog', gameId: 1, plannedId: null, title: 'A', coverUrl: null, hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false, start: '', end: '', days: 1, ...o });

describe('идея 3: «что дальше» из целей месяца и Плана', () => {
  it('первая игра бэклога по расписанию, кроме только что пройденной; релизы пропускает', () => {
    const r = { items: [entry({ kind: 'release', gameId: null, plannedId: 3, title: 'R' }), entry({ gameId: 7, title: 'Done' }), entry({ gameId: 8, title: 'Next', hours: 12.5 })] };
    expect(nextFromPlan(r as never, 7)).toEqual({ gameId: 8, title: 'Next', coverUrl: null, hours: 12.5, source: 'plan' });
    expect(nextFromPlan(r as never, 99)?.gameId).toBe(7);
  });
  it('незакрытая цель месяца выше очереди Плана', () => {
    const r = { items: [entry({ gameId: 7, title: 'PlanFirst' }), entry({ gameId: 8, title: 'Goal', hours: 5 })] };
    expect(nextFromPlan(r as never, 1, [{ id: 8, title: 'Goal', coverUrl: null, completed: false }])).toEqual(
      { gameId: 8, title: 'Goal', coverUrl: null, hours: 5, source: 'month_goal' },
    );
  });
  it('пусто или нет ответа — null', () => {
    expect(nextFromPlan({ items: [] } as never, 1)).toBeNull();
    expect(nextFromPlan(null, 1)).toBeNull();
  });
});

describe('идея 3: событие «Пройдено»', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('шлёт событие с игрой; при открытом окне игры — нет', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const on = vi.fn();
    target.addEventListener(COMPLETED_EVENT, on);
    const noDialog = { querySelector: () => null };
    const withDialog = { querySelector: (s: string) => (s === '.ps-gd' ? ({} as Element) : null) };
    expect(announceCompleted({ id: 5, title: 'Hades', coverUrl: null }, noDialog)).toBe(true);
    expect((on.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 5, title: 'Hades', coverUrl: null });
    expect(announceCompleted({ id: 5, title: 'Hades', coverUrl: null }, withDialog)).toBe(false);
    expect(announceCompleted({ id: 5, title: 'Hades', coverUrl: null }, null)).toBe(false);
    expect(on).toHaveBeenCalledTimes(1);
  });
});
