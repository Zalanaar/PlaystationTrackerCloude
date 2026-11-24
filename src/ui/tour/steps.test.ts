import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, TOUR_TOTAL } from './steps';

describe('конфиг шагов тура', () => {
  it('ровно 7 шагов с уникальными id: синк → Разбор → Играю → Пройдено → оценка → итоги → готово', () => {
    expect(TOUR_TOTAL).toBe(7);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'sync', 'triage', 'playing', 'completed', 'rating', 'wrapped', 'done',
    ]);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(7);
  });

  it('порядок маршрутов: / -> /triage -> / -> / -> / -> /stats -> остаёмся', () => {
    expect(TOUR_STEPS.map((s) => s.route)).toEqual(['/', '/triage', '/', '/', '/', '/stats', '*']);
  });

  it('оценка и готово без подсветки, остальные с якорем', () => {
    const without = TOUR_STEPS.filter((s) => s.target === null && s.targetMobile === null).map((s) => s.id);
    expect(without).toEqual(['rating', 'done']);
  });

  it('мобильные якоря: синк в меню, разбор — кнопки, играю/пройдено — карточка', () => {
    const m = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s.targetMobile]));
    expect(m.sync).toBe('menu-more');
    expect(m.triage).toBe('triage-buttons');
    expect(m.playing).toBe('game-card');
    expect(m.completed).toBe('game-card');
    expect(m.wrapped).toBe('stats-wrapped');
  });

  it('все тексты на русском, непустые, на «ты», без «вот это» и «здесь»', () => {
    for (const s of TOUR_STEPS) {
      for (const t of [s.title, s.text, s.textMobile]) {
        expect(t.length).toBeGreaterThan(3);
        expect(t).toMatch(/[А-Яа-я]/);
        expect(t.toLowerCase()).not.toMatch(/вот это|здесь/);
        expect(t).not.toMatch(/\b[Вв]ы\b|\b[Вв]аш|\bНажмите|\bУдерживайте|\bПоставьте\b/);
      }
    }
  });

  it('шаг синка говорит про автообновление раз в сутки', () => {
    const s = TOUR_STEPS.find((x) => x.id === 'sync')!;
    expect(s.text).toContain('раз в сутки');
    expect(s.textMobile).toContain('раз в сутки');
  });
});
