import { describe, expect, it } from 'vitest';
import type { NearPlatinumItem, PlatinumForecast } from '@/server/collection/types';
import { anyApproximate, avgRarityText, isApproximate, nearAria, nearItems, nearVisible, remainingGrades, trophiesWord } from './nearPlatinum';

const fc = (o: Partial<PlatinumForecast> = {}): PlatinumForecast => ({
  setId: 1, required: 54, earned: 49, progress: 91, remaining: { gold: 1, silver: 1, bronze: 3, total: 5 }, remainingHidden: 0,
  avgEarnedRate: 12.4, minEarnedRate: 1.2, ratesKnown: 5, platinumEarnedRate: 4.3, ...o,
});
const item = (id: number, f = fc()): NearPlatinumItem => ({ game: { id, title: `Игра ${id}` } as NearPlatinumItem['game'], forecast: f });

describe('nearVisible', () => {
  const ok = { count: 3, chronicle: true, status: 'all', q: '', platinum: false, selectMode: false };
  it('виден на чистой коллекции', () => expect(nearVisible(ok)).toBe(true));
  it.each([
    ['пусто', { count: 0 }], ['не хроника', { chronicle: false }], ['статус', { status: 'backlog' }], ['поиск', { q: 'god' }],
    ['пробелы в поиске не скрывают', { q: '  ' }], ['платина', { platinum: true }], ['режим выбора', { selectMode: true }], ['скрытые', { hidden: true }],
  ])('%s', (name, patch) => {
    expect(nearVisible({ ...ok, ...patch })).toBe(name === 'пробелы в поиске не скрывают');
  });
});

describe('тексты', () => {
  it('склонение трофеев', () => {
    expect([1, 2, 4, 5, 11, 21].map(trophiesWord)).toEqual(['1 трофей', '2 трофея', '4 трофея', '5 трофеев', '11 трофеев', '21 трофей']);
  });
  it('редкость: значение с запятой или «неизвестна»', () => {
    expect(avgRarityText(fc())).toBe('ср. редкость 12,4%');
    expect(avgRarityText(fc({ avgEarnedRate: null }))).toBe('редкость неизвестна');
  });
  it('aria-label элемента по спеке', () => {
    expect(nearAria('Horizon', fc())).toBe('Horizon. Прогресс к платине примерно 91%, осталось 5 трофеев');
    expect(nearAria('Horizon', fc({ approximate: false }))).toBe('Horizon. Прогресс к платине 91%, осталось 5 трофеев');
  });
  it('нулевые грейды не выводятся', () => {
    expect(remainingGrades(fc({ remaining: { gold: 0, silver: 2, bronze: 3, total: 5 } })).map((g) => g.grade)).toEqual(['silver', 'bronze']);
  });
});

describe('приблизительность и данные', () => {
  it('по умолчанию «≈», флаг сервера её снимает', () => {
    expect(isApproximate(fc())).toBe(true);
    expect(isApproximate(fc({ approximate: true }))).toBe(true);
    expect(isApproximate(fc({ approximate: false }))).toBe(false);
    expect(anyApproximate([item(1, fc({ approximate: false }))])).toBe(false);
  });
  it('nearItems переживает отсутствие поля и режет до 5', () => {
    expect(nearItems(undefined)).toEqual([]);
    expect(nearItems(null)).toEqual([]);
    expect(nearItems([1, 2, 3, 4, 5, 6, 7].map((i) => item(i)))).toHaveLength(5);
  });
});
