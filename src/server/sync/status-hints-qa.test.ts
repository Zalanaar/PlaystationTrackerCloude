// QA Фазы 27: границы порогов и последствия «Принять» + «Отменить» (откат делает PUT прошлого статуса).
import { describe, expect, it } from 'vitest';
import { hintFor, matchingRules, type HintFacts } from './status-hints';

const NOW = new Date('2026-11-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const facts = (o: Partial<HintFacts> = {}): HintFacts => ({
  gameId: 1, status: null, statusChangedAt: null, droppedAt: null, lastPlayedAt: null, playSeconds: 3600, platinumEarned: false, platinumEarnedAt: null, ...o,
});

describe('QA-27: пороги', () => {
  it('14 суток ровно: started и returned есть, 14 суток и 1 мс: нет', () => {
    const edge = new Date(NOW.getTime() - 14 * 86_400_000);
    const over = new Date(edge.getTime() - 1);
    expect(matchingRules(facts({ status: null, lastPlayedAt: edge }), NOW)).toEqual(['started']);
    expect(matchingRules(facts({ status: null, lastPlayedAt: over }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'dropped', droppedAt: daysAgo(40), statusChangedAt: daysAgo(40), lastPlayedAt: edge }), NOW)).toEqual(['returned']);
    expect(matchingRules(facts({ status: 'dropped', droppedAt: daysAgo(40), statusChangedAt: daysAgo(40), lastPlayedAt: over }), NOW)).toEqual([]);
  });
  it('service и completed не получают никаких подсказок даже с платиной и свежим запуском', () => {
    expect(matchingRules(facts({ status: 'service', platinumEarned: true, lastPlayedAt: daysAgo(1) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'completed', platinumEarned: true, statusChangedAt: daysAgo(90), lastPlayedAt: daysAgo(1) }), NOW)).toEqual([]);
  });
  it('shelved с платиной: «Пройдено?», с поздним статусом: нет', () => {
    expect(matchingRules(facts({ status: 'shelved', platinumEarned: true, platinumEarnedAt: daysAgo(10), statusChangedAt: daysAgo(20) }), NOW)).toEqual(['platinum']);
    expect(matchingRules(facts({ status: 'shelved', platinumEarned: true, platinumEarnedAt: daysAgo(10), statusChangedAt: daysAgo(5) }), NOW)).toEqual([]);
  });
  it('граница МСК/UTC: сутки считаются от момента, не от календарной даты', () => {
    const lp = new Date('2026-10-18T21:30:00Z'); // 19.10 00:30 МСК, 13.6 суток до NOW
    expect(matchingRules(facts({ status: null, lastPlayedAt: lp }), NOW)).toEqual(['started']);
  });
});

describe('QA-27-1: после «Принять» + «Отменить» подсказка пропадает без отказа', () => {
  // PUT прошлого статуса ставит statusChangedAt = сейчас (и dropped_at = последний запуск)
  it('returned: undo -> dropped с новым statusChangedAt, запуск старше: подсказки нет', () => {
    const before = facts({ status: 'dropped', statusChangedAt: daysAgo(60), droppedAt: daysAgo(60), lastPlayedAt: daysAgo(3) });
    expect(hintFor(before, new Set(), NOW)?.rule).toBe('returned');
    const afterUndo = { ...before, statusChangedAt: NOW, droppedAt: before.lastPlayedAt };
    expect(hintFor(afterUndo, new Set(), NOW)).toBeNull();
  });
  it('stale: undo -> playing с новым statusChangedAt: 30 дней тишины', () => {
    const before = facts({ status: 'playing', statusChangedAt: daysAgo(80), lastPlayedAt: daysAgo(50) });
    expect(hintFor(before, new Set(), NOW)?.rule).toBe('stale');
    expect(hintFor({ ...before, statusChangedAt: NOW }, new Set(), NOW)).toBeNull();
  });
});
