import { describe, expect, it } from 'vitest';
import type { GenreKey } from '@/shared/genres';
import { durationFit, platinumClose, scoreBacklog, TOP_N, WEIGHTS, waitingValue } from './score';
import type { Candidate, HistoryGame, ScoreInput, SignalKey } from './types';

const NOW = new Date('2026-10-29T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const cand = (id: number, o: Partial<Candidate> = {}): Candidate => ({
  id, name: `Game ${id}`, imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: null, hoursSource: null, statusChangedAt: NOW, trophy: null, ...o,
});
const hist = (id: number, status: HistoryGame['status'], genres: GenreKey[], hours = 10): HistoryGame => ({ id, status, genres, playSeconds: hours * 3600 });
const run = (o: Partial<ScoreInput> & { candidates: Candidate[] }) =>
  scoreBacklog({ history: [], dislikedIds: new Set(), time: 'any', now: NOW, ...o });
const contrib = (r: ReturnType<typeof run>, idx: number, key: SignalKey) => r.items[idx].signals.find((s) => s.key === key)?.contribution;

describe('scoreBacklog', () => {
  it('пустой бэклог: items [], candidates 0', () => {
    expect(run({ candidates: [] })).toEqual({ items: [], candidates: 0 });
  });

  it('топ-9 и счётчик кандидатов; меньше кандидатов = меньше элементов', () => {
    expect(TOP_N).toBe(9);
    const r = run({ candidates: Array.from({ length: 12 }, (_, i) => cand(i + 1)) });
    expect(r.items).toHaveLength(9);
    expect(r.candidates).toBe(12);
    expect(run({ candidates: Array.from({ length: 9 }, (_, i) => cand(i + 1)) }).items).toHaveLength(9);
    expect(run({ candidates: [cand(1), cand(2)] }).items).toHaveLength(2);
  });

  it('детерминизм: порядок входа не влияет, повтор даёт то же', () => {
    const candidates = [cand(3, { hours: 5 }), cand(1, { genres: ['RACING'] }), cand(2, { statusChangedAt: daysAgo(100) }), cand(4, { hours: 40 })];
    const history = [hist(10, 'completed', ['ACTION'], 50), hist(11, 'dropped', ['RACING'], 2)];
    const a = run({ candidates, history, time: 'short' });
    const b = run({ candidates: [...candidates].reverse(), history: [...history].reverse(), time: 'short' });
    expect(b).toEqual(a);
    expect(run({ candidates, history, time: 'short' })).toEqual(a);
  });

  it('тай-брейк: равные баллы идут по game.id asc', () => {
    const r = run({ candidates: [cand(9), cand(2), cand(5), cand(1)] });
    expect(r.items.map((i) => i.game.id)).toEqual([1, 2, 5, 9]);
  });

  it('дизлайк исключает игру и не считается кандидатом', () => {
    const r = run({ candidates: [cand(1), cand(2), cand(3)], dislikedIds: new Set([1, 2]) });
    expect(r.items.map((i) => i.game.id)).toEqual([3]);
    expect(r.candidates).toBe(1);
    expect(run({ candidates: [cand(1)], dislikedIds: new Set([1]) })).toEqual({ items: [], candidates: 0 });
  });

  it('genre_affinity: жанр с пройденным и часами выше жанра без истории', () => {
    const history = [hist(10, 'completed', ['ACTION'], 100), hist(11, 'completed', ['ACTION'], 50)];
    const r = run({ candidates: [cand(1, { genres: ['PUZZLE'] }), cand(2, { genres: ['ACTION'] })], history });
    expect(r.items[0].game.id).toBe(2);
    expect(contrib(r, 0, 'genre_affinity')).toBeCloseTo(WEIGHTS.genre_affinity, 1); // hoursNorm 1 * 0.6 + share 1 * 0.4 = 1
    expect(r.items[0].signals[0].label).toMatch(/^Любимый жанр: Экшен, 150 ч, 100% пройдено$/);
    expect(r.items[1].signals.find((s) => s.key === 'genre_affinity')).toBeUndefined(); // нет истории по жанру = 0
  });

  it('genre_affinity: игра делится по 1/N между жанрами', () => {
    const history = [hist(10, 'completed', ['ACTION', 'ADVENTURE'], 100)];
    const r = run({ candidates: [cand(1, { genres: ['ACTION', 'PUZZLE'] })], history });
    // ACTION: 1.0 (единственный жанр истории), PUZZLE: 0 -> среднее 0.5 -> вклад 1.5
    expect(contrib(r, 0, 'genre_affinity')).toBe(1.5);
  });

  it('genre_affinity: брошенный жанр даёт отрицательное значение', () => {
    const history = [hist(10, 'dropped', ['HORROR'], 1), hist(11, 'dropped', ['HORROR'], 1)];
    const r = run({ candidates: [cand(1, { genres: ['HORROR'] })], history });
    expect(contrib(r, 0, 'genre_affinity')).toBeLessThan(0);
    expect(r.items[0].signals.find((s) => s.key === 'genre_affinity')!.label).toContain('чаще бросаешь');
  });

  it('dropped_genre_penalty: > 50% брошено при >= 3 играх', () => {
    const three = [hist(10, 'dropped', ['HORROR']), hist(11, 'dropped', ['HORROR']), hist(12, 'completed', ['HORROR'])];
    expect(contrib(run({ candidates: [cand(1, { genres: ['HORROR'] })], history: three }), 0, 'dropped_genre_penalty')).toBe(-2);
    // две игры: рано
    expect(contrib(run({ candidates: [cand(1, { genres: ['HORROR'] })], history: three.slice(0, 2) }), 0, 'dropped_genre_penalty')).toBeUndefined();
    // ровно 50%: не штрафуем
    const half = [hist(10, 'dropped', ['HORROR']), hist(11, 'dropped', ['HORROR']), hist(12, 'completed', ['HORROR']), hist(13, 'completed', ['HORROR'])];
    expect(contrib(run({ candidates: [cand(1, { genres: ['HORROR'] })], history: half }), 0, 'dropped_genre_penalty')).toBeUndefined();
    // половина жанров игры штрафуется -> вклад -1
    expect(contrib(run({ candidates: [cand(1, { genres: ['HORROR', 'PUZZLE'] })], history: three }), 0, 'dropped_genre_penalty')).toBe(-1);
  });

  it('duration_fit: окна short / medium / long и промах линейно к -1', () => {
    expect(durationFit(5, 'short')).toBe(1);
    expect(durationFit(8, 'short')).toBe(1);
    expect(durationFit(18, 'short')).toBe(0); // 10 ч мимо из 20
    expect(durationFit(100, 'short')).toBe(-1);
    expect(durationFit(8, 'medium')).toBe(1);
    expect(durationFit(30, 'medium')).toBe(1);
    expect(durationFit(4, 'medium')).toBe(0.6);
    expect(durationFit(31, 'long')).toBe(1);
    expect(durationFit(20, 'long')).toBe(0);
    expect(durationFit(1, 'long')).toBe(-1);
    expect(durationFit(5, 'any')).toBe(0);
    expect(durationFit(null, 'any')).toBe(0);
  });

  it('duration_fit: короткая игра обгоняет длинную при time=short, вклад с весом 2', () => {
    const r = run({ candidates: [cand(1, { hours: 60 }), cand(2, { hours: 6 })], time: 'short' });
    expect(r.items.map((i) => i.game.id)).toEqual([2, 1]);
    expect(contrib(r, 0, 'duration_fit')).toBe(2);
    expect(contrib(r, 1, 'duration_fit')).toBe(-2);
  });

  it('duration_fit: нет часов = 0 и пометка «Длительность неизвестна»; при any пометки нет', () => {
    const r = run({ candidates: [cand(1, { hours: null })], time: 'short' });
    expect(r.items[0].score).toBe(0);
    expect(r.items[0].signals).toEqual([{ key: 'duration_fit', label: 'Длительность неизвестна', contribution: 0 }]);
    expect(run({ candidates: [cand(1)], time: 'any' }).items[0].signals).toEqual([]);
  });

  it('platinum_close: доля трофеев начатой игры; не начата, нет набора и DLC-хвост', () => {
    expect(platinumClose(null)).toBe(0);
    expect(platinumClose({ earned: 0, total: 40, dlcTail: false })).toBe(0);
    expect(platinumClose({ earned: 30, total: 40, dlcTail: false })).toBe(0.75);
    expect(platinumClose({ earned: 30, total: 40, dlcTail: true })).toBe(0.375);
    const r = run({ candidates: [cand(1, { trophy: { earned: 20, total: 40, dlcTail: false } })] });
    expect(contrib(r, 0, 'platinum_close')).toBe(0.75);
  });

  it('waiting: давность в бэклоге насыщается на 365 днях', () => {
    expect(waitingValue(daysAgo(0), NOW)).toBe(0);
    expect(waitingValue(daysAgo(182.5), NOW)).toBeCloseTo(0.5, 5);
    expect(waitingValue(daysAgo(1000), NOW)).toBe(1);
    expect(waitingValue(new Date(NOW.getTime() + 1e9), NOW)).toBe(0);
    const r = run({ candidates: [cand(1, { statusChangedAt: daysAgo(30) }), cand(2, { statusChangedAt: daysAgo(400) })] });
    expect(r.items[0].game.id).toBe(2);
    expect(contrib(r, 0, 'waiting')).toBe(1);
    expect(r.items[1].signals[0].label).toBe('В бэклоге 30 дн.');
    expect(r.items[0].signals[0].label).toBe('В бэклоге 13 мес.');
  });

  it('«сейчас» аргументом: тот же вход с другим now даёт другой балл', () => {
    const c = [cand(1, { statusChangedAt: daysAgo(10) })];
    const later = scoreBacklog({ candidates: c, history: [], dislikedIds: new Set(), time: 'any', now: new Date(NOW.getTime() + 100 * 86_400_000) });
    expect(later.items[0].score).toBeGreaterThan(run({ candidates: c }).items[0].score);
  });

  it('вес сигналов собирается в балл; скрытые нули не показываются, сигналы по убыванию |вклада|', () => {
    const history = [hist(10, 'completed', ['ACTION'], 100)];
    const r = run({ candidates: [cand(1, { hours: 6, statusChangedAt: daysAgo(365), trophy: { earned: 10, total: 40, dlcTail: false } })], history, time: 'short' });
    const it0 = r.items[0];
    expect(it0.score).toBe(6.38);
    expect(it0.signals.map((s) => s.key)).toEqual(['genre_affinity', 'duration_fit', 'waiting', 'platinum_close']);
  });
});
