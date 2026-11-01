import { describe, expect, it } from 'vitest';
import type { GameDuration } from '@/server/collection/types';
import { formatRemaining, remainingView } from './remaining';

const hltb = { status: 'found', id: 1, name: 'X', mainHours: 20, extraHours: null, checkedAt: null } as const;
const dur = (p: Partial<GameDuration>): GameDuration => ({ hours: 20, source: 'hltb', bucket: '10_30', overrideHours: null, hltb, ...p });

describe('remainingView (Фаза 32)', () => {
  it('formatRemaining: минуты, шаг 0,5 ч, целые', () => {
    expect(formatRemaining(0.75)).toBe('≈ 45 м');
    expect(formatRemaining(2.4)).toBe('≈ 2,5 ч');
    expect(formatRemaining(12.4)).toBe('≈ 12 ч');
  });
  it('A: остаток и доля из API, подсказка «Наиграно»', () => {
    const v = remainingView(dur({ remainingHours: 12, progress: 0.4 }), 8 * 3600);
    expect(v).toMatchObject({ kind: 'remaining', text: '≈ 12 ч', hasWord: true, fill: 0.4, percent: 40, isMinimum: false, sourceText: 'HLTB' });
    expect(v.hint).toBe('Наиграно 8 ч из ≈ 20 ч');
    expect(v.label).toContain('осталось ≈ 12 ч');
  });
  it('B: не начата, пустая дорожка и слово «осталось»', () => {
    expect(remainingView(dur({ remainingHours: 20, progress: 0 }), 0)).toMatchObject({ kind: 'remaining', fill: 0, percent: 0, hasWord: true });
  });
  it('D: вручную', () => {
    expect(remainingView(dur({ source: 'manual', overrideHours: 15, hours: 15, remainingHours: 15, progress: 0 })).sourceText).toBe('вручную');
  });
  it('E/F: минимум 15%, полоса не дальше 85%', () => {
    const v = remainingView(dur({ remainingHours: 3, progress: 0.85 }), 30 * 3600);
    expect(v).toMatchObject({ isMinimum: true, sourceText: 'мин. 15%', percent: 85 });
    expect(v.hint).toContain('минимум 15%');
  });
  it('C: нет часов, не найдено на HLTB', () => {
    expect(remainingView(dur({ hours: null, source: null, bucket: 'unknown', hltb: { ...hltb, status: 'not_found' } }))).toMatchObject({ kind: 'notFound', text: null, fill: null, notOnHltb: true });
  });
  it('H: остаток не известен, полная длительность без слова «осталось»', () => {
    expect(remainingView(dur({}))).toMatchObject({ kind: 'total', text: '≈ 20 ч', hasWord: false, fill: null });
    expect(remainingView(dur({ remainingHours: null, progress: null }))).toMatchObject({ kind: 'total', hasWord: false });
  });
  it('нет данных вовсе: unknown', () => {
    expect(remainingView(undefined).kind).toBe('unknown');
  });
});
