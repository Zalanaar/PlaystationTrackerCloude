import { describe, expect, it } from 'vitest';
import { buildChips, compareHours, isHiddenToday, mskDay, segText, splitMobile, type InboxResponse } from './model';

const base: InboxResponse = {
  now: '2026-11-01T12:00:00.000Z', newGames: 0, newGamesWindow: null, newUnsorted: 0, trophies: 0, platinums: 0, trophiesWindow: null,
  hoursWeek: 0, hoursPrevWeek: 0, hoursNoHistory: false, checkCount: 0, forgottenCount: 0, partial: false, failed: [], isEmpty: true,
};
const full: InboxResponse = {
  ...base, newGames: 3, newGamesWindow: '24h', newUnsorted: 2, trophies: 14, platinums: 1, trophiesWindow: '24h',
  hoursWeek: 12.5, hoursPrevWeek: 9.5, checkCount: 4, forgottenCount: 7, isEmpty: false,
};

describe('buildChips', () => {
  it('пустой ответ и null: чипов нет', () => {
    expect(buildChips(base)).toEqual([]);
    expect(buildChips(null)).toEqual([]);
  });
  it('полный ответ: 5 чипов в порядке A.2 со ссылками', () => {
    const c = buildChips(full);
    expect(c.map((x) => x.testid)).toEqual(['inbox-new', 'inbox-trophies', 'inbox-hours', 'inbox-check', 'inbox-forgotten']);
    expect(c.map((x) => x.href)).toEqual(['/triage', '/stats', '/stats', '/triage?mode=check', '/triage?forgotten=1']);
  });
  it('чип игр: тексты, склонение, окно', () => {
    const [n] = buildChips(full);
    expect(segText(n.desktop)).toBe('+3 новые игры за 24 ч · Разобрать 2');
    expect(segText(n.mobile)).toBe('+3 новые · Разобрать 2');
    expect(n.window).toBe('h24');
    expect(segText(buildChips({ ...full, newGames: 5, newGamesWindow: '7d' })[0].desktop)).toBe('+5 новых игр за 7 дн. · Разобрать 2');
    expect(buildChips({ ...full, newGames: 5, newGamesWindow: '7d' })[0].window).toBe('d7');
    expect(segText(buildChips({ ...full, newGames: 1 })[0].desktop)).toContain('+1 новая игра');
  });
  it('чип игр не показывается без «неразобранных» и без окна', () => {
    expect(buildChips({ ...full, newUnsorted: 0 }).some((x) => x.id === 'new')).toBe(false);
    expect(buildChips({ ...full, newGamesWindow: null }).some((x) => x.id === 'new')).toBe(false);
  });
  it('трофеи и платина', () => {
    const t = buildChips(full)[1];
    expect(segText(t.desktop)).toBe('+14 трофеев за 24 ч, платин: 1');
    expect(segText(t.mobile)).toBe('+14 трофеев, 1 плат.');
    expect(t.platinum).toBe(true);
    const t0 = buildChips({ ...full, platinums: 0, trophies: 2, trophiesWindow: '7d' })[1];
    expect(segText(t0.desktop)).toBe('+2 трофея за 7 дн.');
    expect(t0.platinum).toBe(false);
  });
  it('частичный ответ: поля null не ломают, остальные чипы остаются', () => {
    const p = { ...full, newGames: null, newGamesWindow: null, newUnsorted: null, hoursWeek: null, hoursPrevWeek: null, hoursNoHistory: null, partial: true };
    expect(buildChips(p).map((x) => x.id)).toEqual(['trophies', 'check', 'forgotten']);
  });
  it('один чип: только забытые', () => {
    expect(buildChips({ ...base, forgottenCount: 3, isEmpty: false }).map((x) => x.id)).toEqual(['forgotten']);
  });
  it('нет истории часов: чипа нет', () => {
    expect(buildChips({ ...base, hoursWeek: null, hoursPrevWeek: null, hoursNoHistory: true }).length).toBe(0);
  });
});

describe('часы', () => {
  const H = 3600;
  it('больше / меньше / как на прошлой (порог 15 мин)', () => {
    expect(compareHours(12.5, 9.5)).toEqual({ week: 12.5 * H, diff: 3 * H, trend: 'up' });
    expect(compareHours(1, 2).trend).toBe('down');
    expect(compareHours(2, 2.2).trend).toBe('same');
    expect(compareHours(2.25, 2).trend).toBe('up'); // ровно 15 мин: уже разница
    expect(compareHours(2, null).trend).toBeNull();
  });
  it('тексты', () => {
    const t = (w: number, p: number | null) => buildChips({ ...base, hoursWeek: w, hoursPrevWeek: p, isEmpty: false })[0];
    expect(segText(t(12.5, 9.5).desktop)).toBe('Неделя: 12 ч 30 м, на 3 ч больше прошлой');
    expect(segText(t(12.5, 9.5).mobile)).toBe('12 ч 30 м · +3 ч');
    expect(segText(t(1, 4).mobile)).toBe('1 ч · −3 ч');
    expect(t(1, 4).icon).toBe('trending-down');
    expect(segText(t(2, 2.1).desktop)).toBe('Неделя: 2 ч, как на прошлой');
    expect(t(2, 2.1).icon).toBe('minus');
    expect(segText(t(2, null).desktop)).toBe('Неделя: 2 ч');
    expect(segText(t(0, 3).desktop)).toBe('Неделя: 0 м, на 3 ч меньше прошлой');
  });
});

describe('мобильный лимит', () => {
  it('до 4 чипов видны все', () => {
    const c = buildChips({ ...full, hoursWeek: 0, hoursPrevWeek: 0 });
    expect(splitMobile(c, false)).toEqual({ visible: c, hidden: [] });
  });
  it('5 чипов: часы скрыты, раскрытие возвращает все в порядке', () => {
    const c = buildChips(full);
    const s = splitMobile(c, false);
    expect(s.visible.map((x) => x.id)).toEqual(['new', 'trophies', 'check', 'forgotten']);
    expect(s.hidden.map((x) => x.id)).toEqual(['hours']);
    expect(splitMobile(c, true).visible).toHaveLength(5);
  });
});

describe('скрытие до 00:00 МСК', () => {
  it('день по Москве', () => {
    expect(mskDay(Date.parse('2026-11-01T20:59:59Z'))).toBe('2026-11-01');
    expect(mskDay(Date.parse('2026-11-01T21:00:00Z'))).toBe('2026-11-02');
  });
  it('скрыта только в тот же день МСК', () => {
    const at = Date.parse('2026-11-01T10:00:00Z');
    expect(isHiddenToday('2026-11-01', at)).toBe(true);
    expect(isHiddenToday('2026-10-31', at)).toBe(false);
    expect(isHiddenToday('2026-11-01', Date.parse('2026-11-01T21:00:00Z'))).toBe(false); // после полуночи МСК
    expect(isHiddenToday(null, at)).toBe(false);
    expect(isHiddenToday('мусор', at)).toBe(false);
  });
});
