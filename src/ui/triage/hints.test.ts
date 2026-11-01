import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import {
  acceptHint, checkChipText, checkCountOf, checkSwipe, dismissHint, dropHint, hintAnnounce, hintProgress, hintReason, hintReasonText, initHints, isCurrentStatus, isHintTarget,
  keepHint, keyDateHint, lastAction, platinumDateNote, primaryTarget, restoreSnapshot, settleConflict, undoAcceptBody, undoHintById, replayHint, rollbackHint, summarizeHints, undoHint, type HintItem,
} from './hints';
import { keyCommand } from './triage';

const game = (id: number): GameItem => ({
  id, title: `G${id}`, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: '2026-10-05T10:00:00.000Z', status: null,
  completedAt: null, droppedAt: null, trophies: null, genres: [], bannerUrl: null, hiddenAt: null,
} as unknown as GameItem);
const hint = (id: number, o: Partial<HintItem> = {}): HintItem => ({
  gameId: id, rule: 'started', question: 'Играю?', reason: '', suggested: ['playing'], currentStatus: 'backlog',
  facts: { lastPlayedAt: '2026-10-05T10:00:00.000Z', statusChangedAt: '2026-10-01T10:00:00.000Z', platinumEarnedAt: null, daysSinceLaunch: 3 }, game: game(id), ...o,
});
const ids = (s: { queue: HintItem[] }) => s.queue.map((h) => h.gameId);

describe('очередь «Проверить»', () => {
  it('принять, оставить, не предлагать убирают карточку и считаются проверенными', () => {
    let s = initHints([hint(1), hint(2), hint(3)]);
    s = acceptHint(s, 'playing');
    s = keepHint(s);
    s = dismissHint(s);
    expect(ids(s)).toEqual([]);
    expect(summarizeHints(s.history)).toEqual({ accepted: 1, kept: 1, dismissed: 1 });
    expect(hintProgress(s)).toMatchObject({ done: 3, total: 3, left: 0, fraction: 1 });
  });
  it('пустая очередь безопасна, прогресс пустой = 1', () => {
    const s = initHints([]);
    expect(keepHint(s)).toBe(s);
    expect(hintProgress(s).fraction).toBe(1);
  });
  it('отмена возвращает карточку в начало и отдаёт действие', () => {
    let s = initHints([hint(1), hint(2)]);
    s = dismissHint(s);
    const r = undoHint(s);
    expect(ids(r.state)).toEqual([1, 2]);
    expect(r.undone).toMatchObject({ kind: 'dismiss' });
    expect(r.state.history).toHaveLength(0);
    expect(undoHint(r.state).undone).toBeNull();
  });
  it('откат неудачного запроса и повтор после неудачной отмены', () => {
    let s = acceptHint(initHints([hint(1), hint(2)]), 'playing');
    s = rollbackHint(s, 1);
    expect(ids(s)).toEqual([1, 2]);
    expect(s.history).toHaveLength(0);
    const a = { id: 99, kind: 'dismiss', hint: hint(1) } as const;
    expect(replayHint(s, a).history).toEqual([a]);
    expect(ids(replayHint(s, a))).toEqual([2]);
  });
  it('подсказка, исчезнувшая на сервере, уходит и уменьшает total', () => {
    const s = dropHint(acceptHint(initHints([hint(1), hint(2)]), 'playing'), 1);
    expect(ids(s)).toEqual([2]);
    expect(s.total).toBe(1);
    expect(s.history).toHaveLength(0);
  });
});

describe('цели и состояние статуса', () => {
  const stale = hint(1, { rule: 'stale', suggested: ['shelved', 'dropped'], currentStatus: 'playing' });
  it('у stale две цели, основная shelved', () => {
    expect(primaryTarget(stale)).toBe('shelved');
    expect(isHintTarget(stale, 'dropped')).toBe(true);
    expect(isHintTarget(stale, 'completed')).toBe(false);
  });
  it('текущий статус выключен', () => {
    expect(isCurrentStatus(stale, 'playing')).toBe(true);
    expect(isCurrentStatus(hint(2, { currentStatus: null }), 'playing')).toBe(false);
  });
  it('дата у «Пройдено»: платина, иначе последний запуск', () => {
    const p = hint(1, { rule: 'platinum', suggested: ['completed'], game: { ...game(1), lastPlayedAt: null }, facts: { lastPlayedAt: null, statusChangedAt: null, platinumEarnedAt: '2026-10-12T10:00:00.000Z', daysSinceLaunch: null } });
    expect(keyDateHint(p, 'completed')).toBeNull(); // без запуска подписи с датой нет
    const withLaunch = hint(1, { rule: 'platinum', suggested: ['completed'], facts: p.facts });
    expect(keyDateHint(withLaunch, 'completed')).toBe('дата завершения — последний запуск: 05.10');
    expect(platinumDateNote(withLaunch)).toBe('дата завершения — последний запуск: 05.10');
    expect(platinumDateNote(hint(3))).toBeNull();
    expect(keyDateHint(hint(2), 'completed')).toBe('дата: 5 окт. 2026');
    expect(keyDateHint(hint(2), 'playing')).toBeNull();
  });
});

describe('текст причины §13.2', () => {
  it('started: бэклог с датой статуса', () => {
    expect(hintReasonText(hint(1))).toBe('Последний запуск 5 окт., а статус «Бэклог» стоит с 1 окт. Поставить «Играю»?');
  });
  it('started: без статуса', () => {
    expect(hintReasonText(hint(1, { currentStatus: null }))).toBe('Игра запускалась 5 окт., статуса у неё нет.');
  });
  it('started: нет даты статуса, фрагмент опущен', () => {
    const h = hint(1, { facts: { lastPlayedAt: '2026-10-05T10:00:00.000Z', statusChangedAt: null, platinumEarnedAt: null, daysSinceLaunch: 3 } });
    expect(hintReasonText(h)).toBe('Последний запуск 5 окт., а статус «Бэклог». Поставить «Играю»?');
  });
  it('stale: дни бездействия жирным', () => {
    const h = hint(1, { rule: 'stale', currentStatus: 'playing', suggested: ['shelved', 'dropped'], facts: { lastPlayedAt: '2026-09-24T10:00:00.000Z', statusChangedAt: null, platinumEarnedAt: null, daysSinceLaunch: 42 } });
    expect(hintReasonText(h)).toBe('Статус «Играю», но запусков нет уже 42 дн. (последний 24 сент.). Отложить или бросить?');
    expect(hintReason(h).filter((s) => s.bold).map((s) => s.text)).toEqual(['42 дн.']);
  });
  it('platinum и returned', () => {
    const f = { lastPlayedAt: '2026-10-28T10:00:00.000Z', statusChangedAt: '2026-09-03T10:00:00.000Z', platinumEarnedAt: '2026-10-12T10:00:00.000Z', daysSinceLaunch: 3 };
    expect(hintReasonText(hint(1, { rule: 'platinum', currentStatus: 'playing', facts: f }))).toBe('Получена платина 12 окт., а статус «Играю». Отметить пройденной?');
    expect(hintReasonText(hint(1, { rule: 'platinum', currentStatus: null, facts: { ...f, platinumEarnedAt: null } }))).toBe('Получена платина, а статуса нет. Отметить пройденной?');
    expect(hintReasonText(hint(1, { rule: 'returned', currentStatus: 'dropped', facts: f }))).toBe('Игра в «Брошено» с 3 сент., но запускалась 28 окт., уже после этого. Вернуть в «Играю»?');
  });
});

describe('свайп, клавиши, подписи', () => {
  it('вправо принять, влево оставить, вверх и вниз отключены, ниже порога ничего', () => {
    expect(checkSwipe(120, 10, 300)).toBe('accept');
    expect(checkSwipe(-120, -10, 300)).toBe('keep');
    expect(checkSwipe(10, -200, 300)).toBeNull();
    expect(checkSwipe(5, 200, 300)).toBeNull();
    expect(checkSwipe(50, 0, 300)).toBeNull();
    expect(checkSwipe(40, 0, 300, 0.12)).toBe('accept');
  });
  it('клавиши режима check', () => {
    expect(keyCommand('Enter', true)).toEqual({ type: 'accept' });
    expect(keyCommand('Enter')).toBeNull();
    for (const k of ['n', 'N', 'т', 'Т']) expect(keyCommand(k, true)).toEqual({ type: 'dismiss' });
    expect(keyCommand('n')).toBeNull();
    for (const k of ['0', ' ', 'ArrowRight']) expect(keyCommand(k, true)).toEqual({ type: 'skip' });
    expect(keyCommand('5', true)).toEqual({ type: 'status', status: 'shelved' });
    expect(keyCommand('я', true)).toEqual({ type: 'undo' });
  });
  it('подписи и безопасные числа', () => {
    expect(checkChipText(4)).toBe('Проверить статусы: 4');
    expect(checkCountOf(undefined)).toBe(0);
    expect(checkCountOf(-1)).toBe(0);
    expect(checkCountOf(3.9)).toBe(3);
    expect(hintAnnounce(3, 12, hint(1))).toBe('Подсказка 3 из 12: Играю? G1');
  });
});

describe('откат, привязка к действию, конфликт (Фаза 28)', () => {
  const dropped = (id: number) => hint(id, {
    rule: 'returned', currentStatus: 'dropped', facts: { lastPlayedAt: '2026-10-05T10:00:00.000Z', statusChangedAt: '2026-09-03T08:00:00.000Z', platinumEarnedAt: null, daysSinceLaunch: 3 },
    game: { ...game(id), completedAt: null, droppedAt: '2026-09-02T10:00:00.000Z' },
  });
  it('снимок: статус, statusChangedAt, даты; completedAt только у completed, droppedAt только у dropped', () => {
    expect(restoreSnapshot(dropped(1))).toEqual({ status: 'dropped', statusChangedAt: '2026-09-03T08:00:00.000Z', completedAt: null, droppedAt: '2026-09-02T10:00:00.000Z' });
    const c = hint(2, { currentStatus: 'completed', game: { ...game(2), completedAt: '2026-08-01T00:00:00.000Z', droppedAt: '2026-01-01T00:00:00.000Z' } });
    expect(restoreSnapshot(c)).toMatchObject({ status: 'completed', completedAt: '2026-08-01T00:00:00.000Z', droppedAt: null });
    expect(restoreSnapshot(hint(3, { currentStatus: null }))).toBeNull();
  });
  it('тело отката: restore из снимка до принятия + expectedStatus = принятая цель; без прошлого статуса {status:null} без restore', () => {
    const s = acceptHint(initHints([dropped(1), hint(2, { currentStatus: null })]), 'playing');
    const a = lastAction(s) as Extract<typeof s.history[number], { kind: 'accept' }>;
    expect(undoAcceptBody(a)).toEqual({ status: 'dropped', expectedStatus: 'playing', restore: a.snapshot });
    const s2 = acceptHint(s, 'playing');
    const b = lastAction(s2) as Extract<typeof s.history[number], { kind: 'accept' }>;
    expect(undoAcceptBody(b)).toEqual({ status: null, expectedStatus: 'playing' });
  });
  it('undoHintById откатывает именно своё действие; повторно или чужой id = ничего', () => {
    let s = initHints([hint(1), hint(2), hint(3)]);
    s = acceptHint(s, 'playing');
    const idA = (lastAction(s) as { id: number }).id;
    s = dismissHint(s);
    const idB = (lastAction(s) as { id: number }).id;
    const r = undoHintById(s, idA);
    expect(r.undone).toMatchObject({ kind: 'accept' });
    expect(r.state.history.map((x) => x.id)).toEqual([idB]);
    expect(ids(r.state)).toEqual([1, 3]);
    const again = undoHintById(r.state, idA);
    expect(again.undone).toBeNull();
    expect(again.state).toBe(r.state);
  });
  it('конфликт: карточка уходит, счётчик done не уменьшается, откатить нельзя, Z пропускает запись', () => {
    let s = initHints([hint(1), hint(2), hint(3)]);
    s = keepHint(s);
    s = acceptHint(s, 'playing');
    const id = (lastAction(s) as { id: number }).id;
    s = settleConflict(s, s.history[1].hint, id);
    expect(ids(s)).toEqual([3]);
    expect(hintProgress(s)).toMatchObject({ done: 2, total: 3 });
    expect(summarizeHints(s.history)).toEqual({ accepted: 0, kept: 1, dismissed: 0 });
    expect(undoHintById(s, (lastAction(s) as { id: number }).id).undone).toBeNull();
    expect(undoHint(s).undone).toMatchObject({ kind: 'keep' });
  });
});
