import { describe, expect, it } from 'vitest';
import type { Achievement } from '@/server/achievements/achievements';
import { formatNumber } from '../format';
import { ACH_META, achPercent, achState } from './achievements';

const a = (o: Partial<Achievement>): Achievement => ({ id: 'completed_10', target: 10, value: 0, unlocked: false, at: null, detail: null, ...o });

describe('П13.1 подписи достижений', () => {
  it('у всех 12 есть название и условие', () => {
    expect(Object.keys(ACH_META)).toHaveLength(12);
    for (const m of Object.values(ACH_META)) expect(m.title.length * m.text.length).toBeGreaterThan(0);
  });
  it('состояние', () => {
    expect(achState(a({ value: 7 }))).toBe('7 из 10');
    expect(achState(a({ id: 'hours_1000', target: 1000, value: 120 }))).toBe(`120 из ${formatNumber(1000)} ч`);
    expect(achState(a({ unlocked: true, value: 12, at: '2025-03-18T10:00:00Z' }))).toBe('Получено 18.03.2025');
    expect(achState(a({ id: 'marathon', unlocked: true, target: 100, value: 120, detail: 'Elden Ring' }))).toBe('Получено · Elden Ring');
  });
  it('процент', () => {
    expect(achPercent(a({ value: 7 }))).toBe(70);
    expect(achPercent(a({ value: 9.99 }))).toBe(99);
    expect(achPercent(a({ unlocked: true, value: 10 }))).toBe(100);
  });
});
