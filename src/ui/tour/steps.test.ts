import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, TOUR_TOTAL } from './steps';

describe('конфиг шагов тура (design-system §10.6)', () => {
  it('ровно 14 шагов с уникальными id в порядке таблицы', () => {
    expect(TOUR_TOTAL).toBe(14);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'nav', 'card', 'status', 'search', 'filters', 'window', 'triage', 'backlog', 'backlog-tabs', 'stats', 'wrapped', 'sync', 'theme', 'done',
    ]);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(14);
  });

  it('порядок маршрутов: / -> /triage -> /backlog -> /stats -> остаёмся', () => {
    expect(TOUR_STEPS.map((s) => s.route)).toEqual(['/', '/', '/', '/', '/', '/', '/triage', '/backlog', '/backlog', '/stats', '/stats', '*', '*', '*']);
  });

  it('шаги 6 и 14 без подсветки, остальные с якорем', () => {
    const without = TOUR_STEPS.filter((s) => s.target === null && s.targetMobile === null).map((s) => s.id);
    expect(without).toEqual(['window', 'done']);
  });

  it('мобильные якоря по таблице', () => {
    const m = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s.targetMobile]));
    expect(m.status).toBe('game-card');
    expect(m.filters).toBe('filters-btn');
    expect(m.triage).toBe('triage-stack');
    expect(m.sync).toBe('menu-more');
    expect(m.theme).toBe('menu-more');
  });

  it('все тексты на русском, непустые, без «вот это» и «здесь»', () => {
    for (const s of TOUR_STEPS) {
      for (const t of [s.title, s.text, s.textMobile]) {
        expect(t.length).toBeGreaterThan(3);
        expect(t).toMatch(/[А-Яа-я]/);
        expect(t.toLowerCase()).not.toMatch(/вот это|здесь/);
      }
    }
  });

  it('шаг 8 про HowLongToBeat согласован с BacklogView (метки HLTB и «вручную»)', () => {
    const s = TOUR_STEPS.find((x) => x.id === 'backlog')!;
    expect(s.text).toContain('HowLongToBeat');
    expect(s.text).toContain('вручную');
  });
});
