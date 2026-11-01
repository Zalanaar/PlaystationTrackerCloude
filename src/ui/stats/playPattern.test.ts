import { describe, expect, it } from 'vitest';
import type { PlayPattern } from '@/server/stats/types';
import {
  hourBars, hourRange, patternHeadline, patternReady, patternSlideLabel, patternSummary, peakIndexes, rovingNext, weekdayBars,
} from './playPattern';

const hours = Array.from({ length: 24 }, (_, i) => (i === 21 ? 48 : i === 22 ? 30 : i === 3 ? 1 : 0));
const base: PlayPattern = {
  byHour: hours, byWeekday: [20, 15, 10, 8, 30, 62, 33], total: 178, peakHour: 21, peakWeekday: 5, label: 'по времени трофеев', hasData: true,
};

describe('Когда ты играешь', () => {
  it('диапазон часа, 23 -> 00:00', () => {
    expect(hourRange(21)).toBe('21:00-22:00');
    expect(hourRange(23)).toBe('23:00-00:00');
    expect(hourRange(0)).toBe('00:00-01:00');
  });
  it('пик и ничья: не больше трёх первых', () => {
    expect(peakIndexes([0, 0, 0])).toEqual([]);
    expect(peakIndexes([1, 5, 2, 5])).toEqual([1, 3]);
    expect(peakIndexes([5, 5, 5, 5, 5])).toEqual([0, 1, 2]);
  });
  it('aria-label столбцов с процентом и пиком', () => {
    const b = hourBars(base);
    expect(b[21].text).toBe('21:00-22:00: 48 трофеев, 27%, пик');
    expect(b[22].text).toBe('22:00-23:00: 30 трофеев, 17%');
    expect(b[3].text).toBe('03:00-04:00: 1 трофей, 1%');
    expect(b[0].heightPct).toBe(0);
    expect(b[3].heightPct).toBeGreaterThanOrEqual(3);
    const d = weekdayBars(base);
    expect(d[5].text).toBe('Суббота: 62 трофея, 35%, пик');
  });
  it('итог словами и aria слайда', () => {
    expect(patternSummary(base)).toBe('Чаще всего: 21:00-22:00, суббота');
    expect(patternSlideLabel(base)).toBe('Чаще всего ты получаешь трофеи в 21:00-22:00, любимый день суббота');
  });
  it('готовность: hasData=false и кривые массивы не рисуем', () => {
    expect(patternReady(base)).toBe(true);
    expect(patternReady({ ...base, hasData: false })).toBe(false);
    expect(patternReady({ ...base, byHour: [1, 2] })).toBe(false);
    expect(patternReady({ ...base, peakHour: null })).toBe(false);
    expect(patternReady(undefined)).toBe(false);
  });
  it('заголовок слайда по границам часов', () => {
    expect(patternHeadline(5)).toBe('Ты играешь по утрам');
    expect(patternHeadline(10)).toBe('Ты играешь по утрам');
    expect(patternHeadline(11)).toBe('Ты играешь днём');
    expect(patternHeadline(16)).toBe('Ты играешь днём');
    expect(patternHeadline(17)).toBe('Ты играешь вечерами');
    expect(patternHeadline(22)).toBe('Ты играешь вечерами');
    expect(patternHeadline(23)).toBe('Ты играешь по ночам');
    expect(patternHeadline(4)).toBe('Ты играешь по ночам');
    expect(patternHeadline(0)).toBe('Ты играешь по ночам');
  });
  it('roving: стрелки, Home/End, границы', () => {
    expect(rovingNext('ArrowRight', 23, 24)).toBe(23);
    expect(rovingNext('ArrowLeft', 0, 24)).toBe(0);
    expect(rovingNext('ArrowRight', 3, 24)).toBe(4);
    expect(rovingNext('Home', 9, 24)).toBe(0);
    expect(rovingNext('End', 9, 24)).toBe(23);
    expect(rovingNext('a', 9, 24)).toBeNull();
  });
});
