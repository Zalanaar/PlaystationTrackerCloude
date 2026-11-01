import { describe, expect, it } from 'vitest';
import { WHATS_NEW_ENTRIES } from './entries';
import { autoPathAllowed, autoVisible, forRole, latestId, parseSeen, planAuto, planMenu, seenKey } from './model';

describe('записи', () => {
  it('id строго убывают сверху вниз, уникальны, длины в пределах', () => {
    const ids = WHATS_NEW_ENTRIES.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(ids.length);
    expect(WHATS_NEW_ENTRIES).toHaveLength(12);
    for (const e of WHATS_NEW_ENTRIES) {
      expect(e.title.length).toBeLessThanOrEqual(32);
      expect(e.text.length).toBeLessThanOrEqual(120);
      expect(e.date).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      if (e.action) expect(e.action.href.startsWith('/')).toBe(true);
    }
  });
  it('без «вот это» и «здесь», только русский', () => {
    for (const e of WHATS_NEW_ENTRIES) expect(`${e.title} ${e.text}`.toLowerCase()).not.toMatch(/вот это|здесь/);
  });
  it('максимальный id = 12', () => expect(latestId()).toBe(12));
});

describe('роль', () => {
  it('member не видит запись owner', () => {
    expect(forRole('member').some((e) => e.id === 4)).toBe(false);
    expect(forRole('owner').some((e) => e.id === 4)).toBe(true);
  });
});

describe('planAuto', () => {
  it('первый запуск: до 3 highlight с наибольшим id, ключ ставится на максимум', () => {
    const p = planAuto(null, 'owner');
    expect(p.firstRun).toBe(true);
    expect(p.entries.map((e) => e.id)).toEqual([12, 11, 9]);
    expect(p.markTo).toBe(12);
  });
  it('новая запись (id 13) показывается один раз', () => {
    const extra = [{ id: 13, date: '02.11.2026', title: 'Новое', text: 'Текст.', audience: 'all', highlight: false } as const, ...WHATS_NEW_ENTRIES];
    const p = planAuto(12, 'member', extra);
    expect(p.entries.map((e) => e.id)).toEqual([13]);
    expect(p.markTo).toBe(13);
    expect(planAuto(13, 'member', extra).entries).toEqual([]);
  });
  it('больше 3 непрочитанных: 3 самые новые, закрытие отмечает все', () => {
    const p = planAuto(5, 'owner');
    expect(p.entries.map((e) => e.id)).toEqual([12, 11, 10]);
    expect(p.markTo).toBe(12);
  });
  it('всё прочитано: пусто', () => expect(planAuto(12, 'owner').entries).toEqual([]));
  it('member на id 4: запись owner пропущена', () => expect(planAuto(3, 'member').entries.map((e) => e.id)).not.toContain(4));
});

describe('planMenu и seen', () => {
  it('последние 6 с фильтром роли', () => {
    expect(planMenu('owner').map((e) => e.id)).toEqual([12, 11, 10, 9, 8, 7]);
    expect(planMenu('member')).toHaveLength(6);
    expect(planMenu('member').map((e) => e.id)).toEqual([12, 11, 10, 9, 8, 7]);
  });
  it('parseSeen', () => {
    expect(parseSeen('12')).toBe(12);
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen('abc')).toBeNull();
    expect(parseSeen('-1')).toBeNull();
  });
  it('ключ с userId', () => expect(seenKey(7)).toBe('ps-wn-seen:7'));
});

describe('видимость', () => {
  it('страницы', () => {
    for (const p of ['/', '/backlog', '/stats', '/recommend', '/roadmap']) expect(autoPathAllowed(p)).toBe(true);
    for (const p of ['/triage', '/wrapped', '/onboarding', '/login', '/access', '', null]) expect(autoPathAllowed(p)).toBe(false);
  });
  it('?game=, тур и тост скрывают', () => {
    const ok = { pathname: '/', hasGameParam: false, tourActive: false, toast: false };
    expect(autoVisible(ok)).toBe(true);
    expect(autoVisible({ ...ok, hasGameParam: true })).toBe(false);
    expect(autoVisible({ ...ok, tourActive: true })).toBe(false);
    expect(autoVisible({ ...ok, toast: true })).toBe(false);
    expect(autoVisible({ ...ok, pathname: '/triage' })).toBe(false);
  });
});
