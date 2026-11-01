// Правила подсказок статусов (контракт 28.2-28.3): чистые функции, без БД.
import { describe, expect, it } from 'vitest';
import { groupPlatinum, hintFor, matchingRules, sortHints, type HintFacts, type SetFact } from './status-hints';

const NOW = new Date('2026-11-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const facts = (o: Partial<HintFacts> = {}): HintFacts => ({
  gameId: 1, status: null, statusChangedAt: null, droppedAt: null, lastPlayedAt: null, playSeconds: 3600, platinumEarned: false, platinumEarnedAt: null, ...o,
});
const none = new Set<never>();

describe('started («Играю?»)', () => {
  it('бэклог, запуск после смены статуса и недавно', () => {
    expect(matchingRules(facts({ status: 'backlog', statusChangedAt: daysAgo(20), lastPlayedAt: daysAgo(2) }), NOW)).toEqual(['started']);
  });
  it('бэклог, запуск был до смены статуса: нет', () => {
    expect(matchingRules(facts({ status: 'backlog', statusChangedAt: daysAgo(2), lastPlayedAt: daysAgo(5) }), NOW)).toEqual([]);
  });
  it('бэклог, запуск после смены, но 15 суток назад: нет (устарел)', () => {
    expect(matchingRules(facts({ status: 'backlog', statusChangedAt: daysAgo(60), lastPlayedAt: daysAgo(15) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'backlog', statusChangedAt: daysAgo(60), lastPlayedAt: daysAgo(14) }), NOW)).toEqual(['started']);
  });
  it('без статуса: недавний запуск, но не старый и не нулевые часы', () => {
    expect(matchingRules(facts({ lastPlayedAt: daysAgo(1) }), NOW)).toEqual(['started']);
    expect(matchingRules(facts({ lastPlayedAt: daysAgo(200) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ lastPlayedAt: daysAgo(1), playSeconds: 0 }), NOW)).toEqual([]);
    expect(matchingRules(facts({ lastPlayedAt: null }), NOW)).toEqual([]);
  });
  it('shelved и service не получают «Играю?»', () => {
    expect(matchingRules(facts({ status: 'shelved', statusChangedAt: daysAgo(30), lastPlayedAt: daysAgo(1) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'service', lastPlayedAt: daysAgo(1) }), NOW)).toEqual([]);
  });
});

describe('stale («Отложить / бросить?»)', () => {
  it('«Играю», нет запусков больше 30 суток', () => {
    const f = facts({ status: 'playing', statusChangedAt: daysAgo(90), lastPlayedAt: daysAgo(31) });
    expect(matchingRules(f, NOW)).toEqual(['stale']);
    expect(hintFor(f, none, NOW)?.suggested).toEqual(['shelved', 'dropped']);
  });
  it('ровно 30 суток или свежий запуск: нет', () => {
    expect(matchingRules(facts({ status: 'playing', statusChangedAt: daysAgo(90), lastPlayedAt: daysAgo(30) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'playing', statusChangedAt: daysAgo(90), lastPlayedAt: daysAgo(3) }), NOW)).toEqual([]);
  });
  it('только что поставленный «Играю» (запуск давно) не ругается, пока статусу меньше 30 суток', () => {
    expect(matchingRules(facts({ status: 'playing', statusChangedAt: daysAgo(2), lastPlayedAt: daysAgo(100) }), NOW)).toEqual([]);
  });
  it('«Играю» без запусков вообще: считаем от смены статуса', () => {
    expect(matchingRules(facts({ status: 'playing', statusChangedAt: daysAgo(45) }), NOW)).toEqual(['stale']);
  });
});

describe('platinum («Пройдено?»)', () => {
  it('платина есть, статус не «пройдено»: подсказка, в т.ч. без статуса', () => {
    for (const status of [null, 'playing', 'backlog', 'dropped', 'shelved'] as const) {
      expect(matchingRules(facts({ status, statusChangedAt: status ? daysAgo(60) : null, platinumEarned: true, platinumEarnedAt: daysAgo(3), lastPlayedAt: daysAgo(40) }), NOW), String(status)).toContain('platinum');
    }
  });
  it('«Пройдено» уже стоит: нет', () => {
    expect(matchingRules(facts({ status: 'completed', statusChangedAt: daysAgo(10), platinumEarned: true, platinumEarnedAt: daysAgo(3) }), NOW)).toEqual([]);
  });
  it('перепрохождение: статус «Играю» поставлен после платины: нет; до платины: есть', () => {
    const again = facts({ status: 'playing', statusChangedAt: daysAgo(5), platinumEarned: true, platinumEarnedAt: daysAgo(400), lastPlayedAt: daysAgo(1) });
    expect(matchingRules(again, NOW)).toEqual([]);
    expect(matchingRules({ ...again, statusChangedAt: daysAgo(500) }, NOW)).toEqual(['platinum']);
  });
  it('дата платины неизвестна: подсказка есть', () => {
    expect(matchingRules(facts({ status: 'playing', statusChangedAt: daysAgo(5), platinumEarned: true, platinumEarnedAt: null, lastPlayedAt: daysAgo(1) }), NOW)).toEqual(['platinum']);
  });
});

describe('returned («Вернулся?»)', () => {
  it('брошена, но запускалась после смены статуса и недавно', () => {
    const f = facts({ status: 'dropped', statusChangedAt: daysAgo(100), droppedAt: daysAgo(101), lastPlayedAt: daysAgo(2) });
    expect(matchingRules(f, NOW)).toEqual(['returned']);
    expect(hintFor(f, none, NOW)?.suggested).toEqual(['playing']);
  });
  it('запуск до смены статуса или до ручной даты dropped_at: нет', () => {
    expect(matchingRules(facts({ status: 'dropped', statusChangedAt: daysAgo(1), droppedAt: daysAgo(1), lastPlayedAt: daysAgo(2) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'dropped', statusChangedAt: daysAgo(100), droppedAt: daysAgo(1), lastPlayedAt: daysAgo(2) }), NOW)).toEqual([]);
  });
  it('запуск давно: нет', () => {
    expect(matchingRules(facts({ status: 'dropped', statusChangedAt: daysAgo(300), droppedAt: daysAgo(300), lastPlayedAt: daysAgo(100) }), NOW)).toEqual([]);
  });
});

describe('приоритет, отказы, порядок', () => {
  const both = facts({ status: 'dropped', statusChangedAt: daysAgo(100), droppedAt: daysAgo(100), lastPlayedAt: daysAgo(1), platinumEarned: true, platinumEarnedAt: daysAgo(1) });
  it('одна подсказка на игру: platinum выше returned', () => {
    expect(matchingRules(both, NOW)).toEqual(['platinum', 'returned']);
    expect(hintFor(both, none, NOW)?.rule).toBe('platinum');
  });
  it('отказ по правилу открывает следующее; отказ по всем: null', () => {
    expect(hintFor(both, new Set(['platinum'] as const), NOW)?.rule).toBe('returned');
    expect(hintFor(both, new Set(['platinum', 'returned'] as const), NOW)).toBeNull();
  });
  it('поля подсказки', () => {
    const h = hintFor(both, none, NOW)!;
    expect(h).toMatchObject({ gameId: 1, question: 'Пройдено?', currentStatus: 'dropped', facts: { daysSinceLaunch: 1 } });
    expect(h.reason).toMatch(/Платина получена/);
  });
  it('сортировка: правило, затем недавний запуск, затем id', () => {
    const mk = (gameId: number, o: Partial<HintFacts>) => hintFor(facts({ gameId, ...o }), none, NOW)!;
    const list = sortHints([
      mk(5, { lastPlayedAt: daysAgo(1) }),
      mk(2, { status: 'playing', statusChangedAt: daysAgo(90), lastPlayedAt: daysAgo(60) }),
      mk(3, { platinumEarned: true, platinumEarnedAt: daysAgo(9), lastPlayedAt: daysAgo(9) }),
      mk(4, { platinumEarned: true, platinumEarnedAt: daysAgo(2), lastPlayedAt: daysAgo(2) }),
    ]);
    expect(list.map((h) => h.gameId)).toEqual([4, 3, 5, 2]);
  });
});

describe('groupPlatinum: DLC-платина, PS4 + PS5', () => {
  const set = (o: Partial<SetFact> & { setId: number; gameId: number }): SetFact => ({ definedTotal: 50, earnedPlatinum: 0, platinumEarnedAt: null, ...o });
  it('DLC-сет с собственной платиной не считается, пока база без платины', () => {
    const r = groupPlatinum([set({ gameId: 1, setId: 10, definedTotal: 60 }), set({ gameId: 1, setId: 11, definedTotal: 15, earnedPlatinum: 1, platinumEarnedAt: daysAgo(3) })]);
    expect(r).toEqual({ earned: false, earnedAt: null });
  });
  it('платина в основном сете: считается', () => {
    const r = groupPlatinum([set({ gameId: 1, setId: 10, definedTotal: 60, earnedPlatinum: 1, platinumEarnedAt: daysAgo(3) }), set({ gameId: 1, setId: 11, definedTotal: 15 })]);
    expect(r).toEqual({ earned: true, earnedAt: daysAgo(3) });
  });
  it('PS4 + PS5: платина в любой версии, дата самая ранняя', () => {
    const r = groupPlatinum([
      set({ gameId: 1, setId: 10 }),
      set({ gameId: 2, setId: 20, earnedPlatinum: 1, platinumEarnedAt: daysAgo(30) }),
      set({ gameId: 1, setId: 11, definedTotal: 55, earnedPlatinum: 1, platinumEarnedAt: daysAgo(10) }),
    ]);
    expect(r.earned).toBe(true);
    expect(r.earnedAt).toEqual(daysAgo(30));
  });
  it('ничья по размеру: меньший id сета; нет сетов: нет платины', () => {
    expect(groupPlatinum([set({ gameId: 1, setId: 12, earnedPlatinum: 1 }), set({ gameId: 1, setId: 9 })]).earned).toBe(false);
    expect(groupPlatinum([])).toEqual({ earned: false, earnedAt: null });
  });
});
