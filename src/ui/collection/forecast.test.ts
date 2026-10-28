import { describe, expect, it } from 'vitest';
import type { PlatinumForecast } from '@/server/collection/types';
import { forecastView, rarityOfRate, trophyWord } from './forecast';

const base: PlatinumForecast = {
  setId: 41, required: 54, earned: 49, progress: 91, remaining: { gold: 1, silver: 1, bronze: 3, total: 5 }, remainingHidden: 1,
  avgEarnedRate: 12.4, minEarnedRate: 1.2, ratesKnown: 4, platinumEarnedRate: 4.3, approximate: true, dlc: null,
};

describe('склонение «трофей»', () => {
  it('1, 2–4, 5+, 11–14, 21', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25].map(trophyWord)).toEqual(['трофей', 'трофея', 'трофея', 'трофеев', 'трофеев', 'трофеев', 'трофеев', 'трофей', 'трофея', 'трофеев']);
  });
});

describe('редкость по проценту', () => {
  it('пороги 1, 5, 15; null и NaN', () => {
    expect([0.5, 1, 4.99, 5, 14.9, 15, 80].map(rarityOfRate)).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(rarityOfRate(null)).toBeNull();
    expect(rarityOfRate(Number.NaN)).toBeNull();
  });
});

describe('прогноз платины для окна', () => {
  it('основные подписи', () => {
    const v = forecastView(base);
    expect(v).toMatchObject({
      approximate: true, pct: '91%', pctAria: 'Прогресс к платине: 91%', requiredText: '49 из 54 трофеев (кроме платины)',
      remainingText: '5 трофеев', almost: false, hiddenText: 'из них скрытых: 1', ratesNote: 'Процент известен у 4 из 5 оставшихся', dlcText: null,
    });
    expect(v.grades).toEqual([
      { type: 'gold', count: 1, label: 'Золото: 1' }, { type: 'silver', count: 1, label: 'Серебро: 1' }, { type: 'bronze', count: 3, label: 'Бронза: 3' },
    ]);
    expect(v.metrics.map((m) => m.value)).toEqual(['12,4%', '1,2%', '4,3%']);
    expect(v.metrics[1]).toMatchObject({ sub: 'Очень редкий', segments: 3 });
  });
  it('нулевые грейды не выводятся, нет скрытых и полного набора процентов', () => {
    const v = forecastView({ ...base, remaining: { gold: 0, silver: 2, bronze: 0, total: 2 }, remainingHidden: 0, ratesKnown: 2 });
    expect(v.grades.map((g) => g.type)).toEqual(['silver']);
    expect(v.hiddenText).toBeNull();
    expect(v.ratesNote).toBeNull();
    expect(v.remainingText).toBe('2 трофея');
  });
  it('остался один трофей: «Почти готово»', () => {
    const v = forecastView({ ...base, remaining: { gold: 0, silver: 0, bronze: 1, total: 1 }, ratesKnown: 1 });
    expect(v).toMatchObject({ almost: true, remainingText: 'остался 1 трофей' });
  });
  it('нет процентов: «нет данных», без сегментов', () => {
    const v = forecastView({ ...base, avgEarnedRate: null, minEarnedRate: null, platinumEarnedRate: null, ratesKnown: 0 });
    expect(v.metrics.map((m) => [m.value, m.empty, m.segments])).toEqual([['нет данных', true, null], ['нет данных', true, null], ['нет данных', true, null]]);
    expect(v.ratesNote).toBe('Процент известен у 0 из 5 оставшихся');
  });
  it('approximate не задан или false: без «≈»; DLC показывается отдельно', () => {
    expect(forecastView({ ...base, approximate: false }).approximate).toBe(false);
    expect(forecastView({ ...base, approximate: undefined }).approximate).toBe(false);
    expect(forecastView({ ...base, approximate: false, dlc: { required: 12, earned: 5, remaining: 7 } }).dlcText)
      .toBe('Трофеи DLC (для платины не нужны): получено 5 из 12, осталось 7');
  });
  it('прогресс ограничен 0..100', () => {
    expect(forecastView({ ...base, progress: 140 }).pct).toBe('100%');
    expect(forecastView({ ...base, progress: -3 }).pct).toBe('0%');
  });
});
