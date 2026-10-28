import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { applyStatus, initState, keyCommand, progress, rollback, skip, summarize, swipeTarget, undo } from './triage';

const g = (id: number): GameItem => ({
  id, title: `G${id}`, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: null, status: null,
  completedAt: null, droppedAt: null, trophies: null, genres: [],
});
const ids = (l: GameItem[]) => l.map((x) => x.id);

describe('очередь Разбора', () => {
  it('статус убирает первую игру и пишет историю', () => {
    const s = applyStatus(initState([g(1), g(2), g(3)]), 'completed');
    expect(ids(s.queue)).toEqual([2, 3]);
    expect(s.history).toHaveLength(1);
    expect(summarize(s.history)).toEqual({ completed: 1 });
  });
  it('пропуск уводит игру в конец, пустая очередь безопасна', () => {
    expect(ids(skip(initState([g(1), g(2)])).queue)).toEqual([2, 1]);
    expect(applyStatus(initState([]), 'playing').history).toHaveLength(0);
    expect(skip(initState([])).queue).toEqual([]);
  });
  it('отмена статуса возвращает игру в начало и отдаёт действие для PUT null', () => {
    let s = applyStatus(initState([g(1), g(2)]), 'dropped');
    const r = undo(s);
    expect(ids(r.state.queue)).toEqual([1, 2]);
    expect(r.undone).toMatchObject({ kind: 'status', status: 'dropped' });
    s = r.state;
    expect(s.history).toHaveLength(0);
    expect(undo(s).undone).toBeNull();
  });
  it('отмена пропуска возвращает игру из конца в начало', () => {
    const s = skip(initState([g(1), g(2), g(3)]));
    expect(ids(undo(s).state.queue)).toEqual([1, 2, 3]);
  });
  it('откат неудачного PUT', () => {
    const s = applyStatus(initState([g(1), g(2)]), 'backlog');
    const r = rollback(s, g(1));
    expect(ids(r.queue)).toEqual([1, 2]);
    expect(r.history).toHaveLength(0);
  });
  it('итог по статусам', () => {
    let s = initState([g(1), g(2), g(3), g(4)]);
    s = applyStatus(s, 'completed'); s = applyStatus(s, 'completed'); s = skip(s); s = applyStatus(s, 'dropped');
    expect(summarize(s.history)).toEqual({ completed: 2, dropped: 1 });
  });
});

describe('клавиши и свайп', () => {
  it('клавиши 1-5 = статусы, пробел/стрелка/0 = пропуск, Z/← = отмена, Esc = выход', () => {
    expect(keyCommand('1')).toEqual({ type: 'status', status: 'playing' });
    expect(keyCommand('2')).toEqual({ type: 'status', status: 'completed' });
    expect(keyCommand('3')).toEqual({ type: 'status', status: 'backlog' });
    expect(keyCommand('4')).toEqual({ type: 'status', status: 'dropped' });
    expect(keyCommand('5')).toEqual({ type: 'status', status: 'shelved' });
    expect(keyCommand('6')).toEqual({ type: 'status', status: 'service' });
    for (const k of [' ', 'ArrowRight', '0']) expect(keyCommand(k)).toEqual({ type: 'skip' });
    for (const k of ['z', 'Z', 'ArrowLeft']) expect(keyCommand(k)).toEqual({ type: 'undo' });
    expect(keyCommand('Escape')).toEqual({ type: 'exit' });
    expect(keyCommand('q')).toBeNull();
  });
  it('свайп: вправо ○, влево ✕, вверх □, вниз пропуск, ниже порога 30% ничего', () => {
    expect(swipeTarget(120, 10, 300)).toBe('completed');
    expect(swipeTarget(-120, 10, 300)).toBe('dropped');
    expect(swipeTarget(5, -120, 300)).toBe('backlog');
    expect(swipeTarget(5, 120, 300)).toBe('skip');
    expect(swipeTarget(60, 10, 300)).toBeNull();
    expect(swipeTarget(90, 0, 300)).toBe('completed');
  });
  it('прогресс «37 / 214», осталось', () => {
    expect(progress(214, 177)).toEqual({ done: 37, total: 214, left: 177, fraction: 37 / 214 });
    expect(progress(0, 0).fraction).toBe(1);
  });
});
