import { describe, expect, it } from 'vitest';
import { pickBaseHours, remainingHours } from './remaining';

const h = (x: number) => x * 3600;

describe('remainingHours (D3)', () => {
  it('ничего не наиграно: остаток = база, прогресс 0', () => {
    expect(remainingHours(20, 0)).toEqual({ remaining: 20, progress: 0 });
  });
  it('наиграно часть: база − наиграно', () => {
    expect(remainingHours(20, h(5))).toEqual({ remaining: 15, progress: 0.25 });
  });
  it('граница 15%: ровно на пороге и за ним остаток не меньше 15% базы', () => {
    expect(remainingHours(10, h(8.5))).toEqual({ remaining: 1.5, progress: 0.85 });
    expect(remainingHours(10, h(9))).toEqual({ remaining: 1.5, progress: 0.85 });
    expect(remainingHours(10, h(8))).toEqual({ remaining: 2, progress: 0.8 });
  });
  it('наиграно больше базы: остаток = 15% базы, не ноль', () => {
    expect(remainingHours(40, h(100))).toEqual({ remaining: 6, progress: 0.85 });
  });
  it('нет базы: null', () => {
    for (const b of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(remainingHours(b, h(3))).toEqual({ remaining: null, progress: null });
    }
  });
  it('мусорные секунды = 0 наиграно', () => {
    expect(remainingHours(10, -5).remaining).toBe(10);
    expect(remainingHours(10, Number.NaN).remaining).toBe(10);
    expect(remainingHours(10, null).remaining).toBe(10);
  });
  it('очень короткая игра: минимум 0.1 ч', () => {
    expect(remainingHours(0.2, h(5)).remaining).toBe(0.1);
  });
  it('округление до 0.1', () => {
    expect(remainingHours(12.34, h(1.01)).remaining).toBe(11.3);
  });
});

describe('pickBaseHours: ручная оценка приоритетнее HLTB', () => {
  it('override > hltb', () => {
    expect(pickBaseHours(10, 30)).toBe(10);
  });
  it('нет override: hltb', () => {
    expect(pickBaseHours(null, 30)).toBe(30);
  });
  it('нет ничего или нули', () => {
    expect(pickBaseHours(null, null)).toBeNull();
    expect(pickBaseHours(0, 0)).toBeNull();
    expect(pickBaseHours(0, 12)).toBe(12);
  });
});
