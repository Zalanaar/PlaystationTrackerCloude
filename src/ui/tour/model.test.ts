import { describe, expect, it } from 'vitest';
import {
  announce, anchorCandidates, canAutoStart, keyboardHeight, nextIndex, parseResume, placePopover, prevIndex, scrollDelta, sideOrder, spotBox,
  stepIndexById, textForAnchor, variantFor, needsNavigation, pageMarkerFor, isLast, isFirst,
} from './model';
import { TOUR_STEPS } from './steps';

const step = (id: string) => TOUR_STEPS.find((s) => s.id === id)!;

describe('выбор шага и варианта', () => {
  it('возобновление по id из sessionStorage', () => {
    expect(parseResume('triage')).toBe(6);
    expect(parseResume('nav')).toBe(0);
    expect(parseResume('нет такого')).toBeNull();
    expect(parseResume(null)).toBeNull();
    expect(stepIndexById('')).toBeNull();
  });

  it('границы навигации', () => {
    expect(prevIndex(0)).toBe(0);
    expect(nextIndex(13)).toBe(13);
    expect(nextIndex(2)).toBe(3);
    expect(isFirst(0)).toBe(true);
    expect(isLast(13)).toBe(true);
    expect(isLast(12)).toBe(false);
  });

  it('вариант десктоп/моб.: якорь, текст, заметка', () => {
    const d = variantFor(step('status'), false);
    const m = variantFor(step('status'), true);
    expect(d.targetId).toBe('card-status');
    expect(m.targetId).toBe('game-card');
    expect(m.text).toMatch(/Удерживайте/);
    expect(m.note).toBe(d.note); // заметка не задана для моб.: как у десктопа
    expect(variantFor(step('window'), true).targetId).toBeNull();
  });

  it('кандидаты якоря: свой, затем запасной другого варианта, без дублей', () => {
    expect(anchorCandidates(step('triage'), false)).toEqual(['triage-actions', 'triage-buttons']);
    expect(anchorCandidates(step('triage'), true)).toEqual(['triage-buttons', 'triage-actions']);
    expect(anchorCandidates(step('nav'), true)).toEqual(['nav']);
    expect(anchorCandidates(step('window'), false)).toEqual([]);
  });

  it('текст под запасной якорь берётся из другого варианта', () => {
    expect(textForAnchor(step('triage'), false, 'triage-actions')).toMatch(/Клавиши 1–6/);
    expect(textForAnchor(step('triage'), false, 'triage-buttons')).toMatch(/Свайп/);
    expect(textForAnchor(step('triage'), true, 'triage-buttons')).toMatch(/Свайп/);
  });

  it('маршруты: когда нужна навигация и какой маркер ждать', () => {
    expect(needsNavigation('/triage', '/')).toBe(true);
    expect(needsNavigation('/', '/')).toBe(false);
    expect(needsNavigation('*', '/stats')).toBe(false);
    expect(pageMarkerFor('/backlog')).toBe('backlog');
    expect(pageMarkerFor('*')).toBeNull();
  });

  it('live-текст шага', () => {
    expect(announce(2, 'Смена статуса', 'Текст')).toBe('Шаг 3 из 14. Смена статуса. Текст');
  });
});

describe('автозапуск', () => {
  const base = { pathname: '/', search: '', apiShouldStart: true, shownThisSession: false, seenFlag: null, version: 1, tourActive: false };
  it('да, когда API разрешает', () => expect(canAutoStart(base)).toBe(true));
  it('нет: API запретил, уже показывали, тур идёт', () => {
    expect(canAutoStart({ ...base, apiShouldStart: false })).toBe(false);
    expect(canAutoStart({ ...base, shownThisSession: true })).toBe(false);
    expect(canAutoStart({ ...base, tourActive: true })).toBe(false);
  });
  it('нет: запасной флаг текущей версии, да: флаг старой версии', () => {
    expect(canAutoStart({ ...base, seenFlag: '1' })).toBe(false);
    expect(canAutoStart({ ...base, seenFlag: '1', version: 2 })).toBe(true);
  });
  it('нет: /wrapped, /onboarding, /login и открытое окно игры', () => {
    for (const pathname of ['/wrapped', '/onboarding', '/login', '/wrapped/x']) expect(canAutoStart({ ...base, pathname })).toBe(false);
    expect(canAutoStart({ ...base, search: '?game=5' })).toBe(false);
    expect(canAutoStart({ ...base, pathname: '/backlog', search: '?q=a' })).toBe(true);
  });
});

describe('геометрия', () => {
  const vp = { w: 1000, h: 800 };
  it('прожектор: pad и клампинг в экран', () => {
    expect(spotBox({ x: 100, y: 100, w: 200, h: 100 }, 8, 44, vp, 2)).toEqual({ x: 92, y: 92, w: 216, h: 116 });
    const b = spotBox({ x: 0, y: 0, w: 1000, h: 56 }, 6, 44, vp, 2);
    expect(b.x).toBe(2);
    expect(b.x + b.w).toBe(998);
    expect(b.y).toBe(2);
  });
  it('прожектор: сторона < 32 расширяется до 44 с сохранением центра', () => {
    const b = spotBox({ x: 100, y: 100, w: 8, h: 8 }, 8, 44, vp, 2);
    expect(b).toEqual({ x: 100 + 4 - 22 - 8, y: 100 + 4 - 22 - 8, w: 60, h: 60 });
  });
  it('высокий элемент обрезается по видимой области', () => {
    const b = spotBox({ x: 100, y: -300, w: 400, h: 2000 }, 8, 44, vp, 2);
    expect(b.y).toBe(2);
    expect(b.y + b.h).toBe(798);
  });
  it('порядок сторон: заданная, противоположная, остальные', () => {
    expect(sideOrder('right')).toEqual(['right', 'left', 'bottom', 'top']);
    expect(sideOrder('bottom')).toEqual(['bottom', 'top', 'right', 'left']);
    expect(sideOrder('center')[0]).toBe('bottom');
  });
  it('поповер: на своей стороне, если помещается', () => {
    const p = placePopover({ x: 100, y: 100, w: 200, h: 50 }, { w: 360, h: 200 }, vp, 'bottom', 12, 24);
    expect(p).toEqual({ left: 24, top: 162, side: 'bottom' });
  });
  it('поповер: не помещается снизу -> сверху', () => {
    const p = placePopover({ x: 400, y: 700, w: 100, h: 50 }, { w: 360, h: 200 }, vp, 'bottom', 12, 24);
    expect(p.side).toBe('top');
    expect(p.top).toBe(700 - 12 - 200);
  });
  it('поповер: поперечная ось зажата полем', () => {
    const p = placePopover({ x: 900, y: 100, w: 90, h: 50 }, { w: 360, h: 200 }, vp, 'bottom', 12, 24);
    expect(p.left).toBe(1000 - 24 - 360);
  });
  it('поповер: нигде не помещается -> нижний центр', () => {
    const p = placePopover({ x: 2, y: 2, w: 996, h: 796 }, { w: 360, h: 200 }, vp, 'bottom', 12, 24);
    expect(p.side).toBe('fallback');
    expect(p.top).toBe(800 - 24 - 200);
    expect(p.left).toBe(320);
  });
  it('прокрутка к элементу', () => {
    const area = { top: 100, bottom: 700 };
    expect(scrollDelta({ top: 200, bottom: 300 }, area)).toBe(0);
    expect(scrollDelta({ top: 800, bottom: 900 }, area)).toBe(850 - 400);
    expect(scrollDelta({ top: 20, bottom: 60 }, area)).toBe(40 - 400);
    expect(scrollDelta({ top: 300, bottom: 2000 }, area)).toBe(200);
  });
  it('экранная клавиатура', () => {
    expect(keyboardHeight(800, null)).toBe(0);
    expect(keyboardHeight(800, { height: 790, offsetTop: 0 })).toBe(0);
    expect(keyboardHeight(800, { height: 480, offsetTop: 0 })).toBe(320);
    expect(keyboardHeight(800, { height: 480, offsetTop: 20 })).toBe(300);
  });
});
