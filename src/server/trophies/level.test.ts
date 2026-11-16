import { describe, expect, it } from 'vitest';
import { etaDate, levelFromPoints, milestoneAfter, pointsOf, pointsToReach, stepAt } from './level';

describe('П12.3 шкала уровней PSN', () => {
  it('очки трофеев', () => {
    expect(pointsOf({ platinum: 1, gold: 2, silver: 3, bronze: 4 })).toBe(300 + 180 + 90 + 60);
  });
  it('шаги по сотням', () => {
    expect([stepAt(1), stepAt(99), stepAt(100), stepAt(199), stepAt(200), stepAt(300), stepAt(400), stepAt(998)]).toEqual([60, 60, 90, 90, 450, 900, 1350, 3600]);
  });
  it('очки до уровня: 100 = 5940, 200 = 14940, 300 = 59940', () => {
    expect(pointsToReach(1)).toBe(0);
    expect(pointsToReach(2)).toBe(60);
    expect(pointsToReach(100)).toBe(5940);
    expect(pointsToReach(200)).toBe(14940);
    expect(pointsToReach(300)).toBe(59940);
  });
  it('уровень по очкам и обратно', () => {
    expect(levelFromPoints(0)).toEqual({ level: 1, progress: 0 });
    expect(levelFromPoints(59)).toEqual({ level: 1, progress: 98 });
    expect(levelFromPoints(5940)).toEqual({ level: 100, progress: 0 });
    expect(levelFromPoints(5940 + 45)).toEqual({ level: 100, progress: 50 });
    for (const l of [7, 150, 312, 555, 998]) expect(levelFromPoints(pointsToReach(l)).level).toBe(l);
    expect(levelFromPoints(1e9).level).toBe(999);
  });
  it('круглая цель', () => {
    expect(milestoneAfter(12)).toBe(25);
    expect(milestoneAfter(99)).toBe(100);
    expect(milestoneAfter(312)).toBe(400);
    expect(milestoneAfter(999)).toBeNull();
  });
  it('прогноз даты', () => {
    const now = new Date('2026-11-16T21:00:00Z'); // 17.11 МСК
    expect(etaDate(100, 10, now)).toBe('2026-11-27');
    expect(etaDate(100, 0, now)).toBeNull();
    expect(etaDate(0, 10, now)).toBeNull();
    expect(etaDate(1e9, 1, now)).toBeNull();
  });
});
