import { describe, expect, it } from 'vitest';
import type { PlayedItem } from '@/server/stats/types';
import {
  excludedToast, excludePlan, hoursText, monthActionLabel, monthFrom, monthTo, restoredToast, splitHours,
} from './monthExclusion';

const item = (o: Partial<PlayedItem> = {}): PlayedItem => ({
  game: {} as PlayedItem['game'], hours: 6, hoursReal: 5, hoursEstimated: 1, estimated: true, finished: null, finishedAt: null, ...o,
});

describe('падежи месяцев', () => {
  it('«из октября», «в октябрь»', () => {
    expect(monthFrom(10)).toBe('октября');
    expect(monthFrom(3)).toBe('марта');
    expect(monthTo(10)).toBe('октябрь');
    expect(monthTo(8)).toBe('август');
    expect(monthFrom(13)).toBe('');
  });
});

describe('разбор часов', () => {
  it('раздельные поля имеют приоритет', () => {
    expect(splitHours(item())).toEqual({ real: 5, estimated: 1 });
    expect(splitHours(item({ hoursReal: 0, hoursEstimated: 6 }))).toEqual({ real: 0, estimated: 6 });
  });
  it('старый ответ без hoursReal: оценочная игра целиком оценка, иначе целиком измерено', () => {
    expect(splitHours({ hours: 4, estimated: true })).toEqual({ real: 0, estimated: 4 });
    expect(splitHours({ hours: 4, estimated: false })).toEqual({ real: 4, estimated: 0 });
  });
  it('hoursText', () => {
    expect(hoursText(5)).toBe('5 ч');
    expect(hoursText(0.7)).toBe('42 м');
    expect(hoursText(0)).toBe('менее минуты');
  });
});

describe('план исключения', () => {
  it('только оценка: без диалога', () => {
    expect(excludePlan(item({ hoursReal: 0, hoursEstimated: 6 }), 10)).toEqual({ kind: 'silent' });
    expect(excludePlan(item({ hoursReal: undefined, hoursEstimated: undefined, hours: 3, estimated: true }), 10)).toEqual({ kind: 'silent' });
  });
  it('измеренные часы: диалог, оценочной части нет в тексте', () => {
    const p = excludePlan(item({ hoursReal: 5, hoursEstimated: 0, estimated: false }), 10);
    expect(p).toMatchObject({ kind: 'confirm', title: 'Убрать из списка октября?' });
    if (p.kind === 'confirm') {
      expect(p.lines).toHaveLength(1);
      expect(p.lines[0]).toContain('Измеренные часы (5 ч) останутся');
    }
  });
  it('смешанный случай: вторая строка про перераспределение', () => {
    const p = excludePlan(item({ hoursReal: 5, hoursEstimated: 1.5 }), 3);
    expect(p.kind).toBe('confirm');
    if (p.kind === 'confirm') expect(p.lines[1]).toBe('Оценочная часть (1 ч 30 м) будет перераспределена по другим месяцам игры.');
  });
});

describe('тосты', () => {
  it('оценка перераспределена, выпала, ничего', () => {
    expect(excludedToast({ redistributed: true, estimateDropped: false }, 10, false)).toBe('Игра убрана из октября. Оценочные часы перераспределены по другим месяцам');
    expect(excludedToast({ redistributed: false, estimateDropped: true }, 10, false)).toContain('выпали из статистики');
    expect(excludedToast({ redistributed: false, estimateDropped: false }, 10, false)).toBe('Игра убрана из октября');
  });
  it('с измеренными часами: список и честная оговорка', () => {
    expect(excludedToast({ redistributed: false, estimateDropped: false }, 10, true)).toBe('Игра убрана из списка октября. Измеренные часы остаются');
    expect(excludedToast({ redistributed: true, estimateDropped: false }, 10, true)).toContain('оценочная часть перераспределена');
    expect(excludedToast({ redistributed: false, estimateDropped: true }, 10, true)).toContain('оценочные часы выпали');
  });
  it('возврат и подписи', () => {
    expect(restoredToast(10)).toBe('Игра возвращена в октябрь');
    expect(monthActionLabel('Hades', 10)).toBe('Действия: Hades, октябрь');
  });
});
