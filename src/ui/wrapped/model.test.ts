import { describe, expect, it } from 'vitest';
import type { WrappedResponse } from '@/server/wrapped/types';
import {
  classifyGesture, counterValue, daysText, genreShare, initialOf, inMonth, isAutoAdvance, keyAction, monthPrepositional,
  approxHours, estimateBadge, parseDurationMs, parseYearParam, partialBadge, resolveSlides, segmentFill, stepIndex, syncStartedText, tapDirection,
  tickTimer, timerFraction, TIMER_START, gamesText, hoursText, launchesLabel, cascadeDelay, slideCover,
} from './model';

describe('год из URL', () => {
  it('валидный и мусор', () => {
    expect(parseYearParam('2025')).toBe(2025);
    expect(parseYearParam(null)).toBeNull();
    expect(parseYearParam('abc')).toBeNull();
    expect(parseYearParam('1999')).toBeNull();
    expect(parseYearParam('2101')).toBeNull();
    expect(parseYearParam('20')).toBeNull();
  });
});

describe('слайды', () => {
  it('строго по списку сервера', () => {
    expect(resolveSlides({ mode: 'story', slides: ['start', 'trophies', 'final'] })).toEqual(['start', 'trophies', 'final']);
  });
  it('empty и пустой список', () => {
    expect(resolveSlides({ mode: 'empty', slides: ['empty'] })).toEqual(['empty']);
    expect(resolveSlides({ mode: 'story', slides: [] })).toEqual(['start', 'final']);
    // год без данных определяется только mode, а не содержимым slides
    expect(resolveSlides({ mode: 'empty', slides: ['start', 'final'] })).toEqual(['empty']);
    expect(resolveSlides({ mode: 'story', slides: ['empty'] })).toEqual(['start', 'final']);
  });
  it('неизвестные и дубликаты отбрасываются', () => {
    expect(resolveSlides({ mode: 'story', slides: ['start', 'zzz' as never, 'start', 'final'] })).toEqual(['start', 'final']);
  });
});

describe('навигация', () => {
  it('границы', () => {
    expect(stepIndex(0, 'prev', 8)).toBe(0);
    expect(stepIndex(7, 'next', 8)).toBe(7);
    expect(stepIndex(3, 'next', 8)).toBe(4);
    expect(stepIndex(3, 'prev', 8)).toBe(2);
    expect(stepIndex(0, 'next', 1)).toBe(0);
  });
  it('тап 30/70', () => {
    expect(tapDirection(0, 400)).toBe('prev');
    expect(tapDirection(119, 400)).toBe('prev');
    expect(tapDirection(120, 400)).toBe('next');
    expect(tapDirection(399, 400)).toBe('next');
    expect(tapDirection(10, 0)).toBe('next');
  });
  it('клавиши', () => {
    expect(keyAction({ key: 'ArrowRight' })).toBe('next');
    expect(keyAction({ key: 'ArrowLeft' })).toBe('prev');
    expect(keyAction({ key: ' ' })).toBe('next');
    expect(keyAction({ key: ' ', onButton: true })).toBeNull();
    expect(keyAction({ key: 'Escape' })).toBe('close');
    expect(keyAction({ key: 'ArrowRight', ctrl: true })).toBeNull();
    expect(keyAction({ key: 'a' })).toBeNull();
  });
});

describe('жесты', () => {
  const base = { dy: 0, durationMs: 100, x: 300, width: 400 };
  it('свайп влево вперёд, вправо назад', () => {
    expect(classifyGesture({ ...base, dx: -80 })).toEqual({ kind: 'swipe', dir: 'next' });
    expect(classifyGesture({ ...base, dx: 80 })).toEqual({ kind: 'swipe', dir: 'prev' });
  });
  it('порог свайпа', () => {
    expect(classifyGesture({ ...base, dx: -49 })).toEqual({ kind: 'none' });
    expect(classifyGesture({ ...base, dx: -50 })).toEqual({ kind: 'swipe', dir: 'next' });
  });
  it('вертикальный жест не свайп', () => {
    expect(classifyGesture({ ...base, dx: 60, dy: 90 })).toEqual({ kind: 'none' });
  });
  it('тап и удержание', () => {
    expect(classifyGesture({ ...base, dx: 2, dy: 3 })).toEqual({ kind: 'tap', dir: 'next' });
    expect(classifyGesture({ ...base, dx: 0, x: 50 })).toEqual({ kind: 'tap', dir: 'prev' });
    expect(classifyGesture({ ...base, dx: 0, durationMs: 400 })).toEqual({ kind: 'hold' });
  });
});

describe('таймер', () => {
  const o = { duration: 7000, paused: false, auto: true };
  it('идёт и завершается', () => {
    let s = TIMER_START;
    let done = false;
    for (let i = 0; i < 70 && !done; i++) ({ state: s, done } = tickTimer(s, 100, o));
    expect(done).toBe(true);
    expect(s.elapsed).toBe(7000);
    expect(timerFraction(s, 7000)).toBe(1);
  });
  it('пауза и ручной режим стоят', () => {
    expect(tickTimer({ elapsed: 10 }, 50, { ...o, paused: true }).state.elapsed).toBe(10);
    expect(tickTimer({ elapsed: 10 }, 50, { ...o, auto: false }).state.elapsed).toBe(10);
  });
  it('большой кадр обрезается', () => {
    expect(tickTimer(TIMER_START, 5000, o).state.elapsed).toBe(100);
    expect(tickTimer(TIMER_START, -5, o).state.elapsed).toBe(0);
  });
  it('длительность токена', () => {
    expect(parseDurationMs('7000ms')).toBe(7000);
    expect(parseDurationMs(' 7s ')).toBe(7000);
    expect(parseDurationMs('')).toBe(7000);
    expect(parseDurationMs('abc', 5)).toBe(5);
  });
  it('заполнение сегментов', () => {
    expect(segmentFill(0, 2, 0.5, true)).toBe(1);
    expect(segmentFill(3, 2, 0.5, true)).toBe(0);
    expect(segmentFill(2, 2, 0.5, true)).toBe(0.5);
    expect(segmentFill(2, 2, 0.5, false)).toBe(1);
  });
  it('автопереход', () => {
    const b = { reducedMotion: false, index: 1, count: 8, slide: 'hours' as const };
    expect(isAutoAdvance(b)).toBe(true);
    expect(isAutoAdvance({ ...b, reducedMotion: true })).toBe(false);
    expect(isAutoAdvance({ ...b, index: 7, slide: 'final' })).toBe(false);
    expect(isAutoAdvance({ ...b, index: 0, count: 1, slide: 'empty' })).toBe(false);
    expect(isAutoAdvance({ ...b, index: 1, count: 3, slide: 'trophies' })).toBe(true);
    expect(isAutoAdvance({ ...b, index: 2, count: 3, slide: 'trophies' })).toBe(false); // последний не идёт дальше
  });
});

describe('счётчик', () => {
  it('0 -> цель', () => {
    expect(counterValue(0, 412.4)).toBe(0);
    expect(counterValue(450, 100)).toBeGreaterThan(50);
    expect(counterValue(450, 100)).toBeLessThan(100);
    expect(counterValue(900, 412.4)).toBe(412.4);
    expect(counterValue(5000, 412.4)).toBe(412.4);
  });
  it('reduced-motion сразу значение', () => {
    expect(counterValue(0, 412.4, { reducedMotion: true })).toBe(412.4);
    expect(cascadeDelay(3, true)).toBe(0);
    expect(cascadeDelay(3, false)).toBe(240);
  });
});

describe('форматирование', () => {
  it('месяцы в предложном падеже', () => {
    expect(monthPrepositional(10)).toBe('октябре');
    expect(monthPrepositional(3)).toBe('марте');
    expect(inMonth(5)).toBe('в мае');
    expect(inMonth(13)).toBe('');
  });
  it('дни', () => {
    expect(daysText(17.2)).toBe('≈ 17 дней');
    expect(daysText(21.4)).toBe('≈ 21 день');
    expect(daysText(2.2)).toBe('≈ 2 дня');
    expect(daysText(11.6)).toBe('≈ 12 дней');
    expect(daysText(0.2)).toBe('меньше суток');
    expect(daysText(null)).toBeNull();
  });
  it('склонения и числа', () => {
    expect(gamesText(1)).toBe('1 игра');
    expect(gamesText(3)).toBe('3 игры');
    expect(gamesText(12)).toBe('12 игр');
    expect(launchesLabel(21)).toBe('21 запуск');
    expect(hoursText(412.4)).toBe('412,4');
    expect(hoursText(1234)).toBe('1 234');
  });
  it('аватар', () => {
    expect(initialOf('artem_ps')).toBe('A');
    expect(initialOf('  zed')).toBe('Z');
    expect(initialOf(null)).toBe('?');
    expect(initialOf('')).toBe('?');
  });
  it('даты синка', () => {
    expect(syncStartedText('2026-03-04')).toBe('Синк начался 04.03.2026');
    expect(syncStartedText(null)).toBeNull();
    expect(syncStartedText('bad')).toBeNull();
    expect(partialBadge('2026-03-04')).toContain('04.03.2026');
    expect(partialBadge(null)).not.toContain('(');
    expect(estimateBadge('2026-03-04')).toBe('До 04.03.2026 часы оценены: распределены равномерно между первым и последним запуском игры');
    expect(estimateBadge(null)).toBe('Часы оценены: распределены равномерно между первым и последним запуском игры');
    expect(approxHours(412.4, true)).toBe('≈ 412,4');
    expect(approxHours(412.4, false)).toBe('412,4');
  });
  it('доля жанра', () => {
    expect(genreShare(5, 10)).toBe(0.5);
    expect(genreShare(5, 0)).toBe(0);
  });
  it('обложка слайда', () => {
    const g = (t: string) => ({ coverUrl: `u-${t}`, title: t });
    const d = {
      topGames: { items: [{ game: g('A') }] }, finished: { completed: { items: [] }, dropped: { items: [{ game: g('D') }] } },
      trophies: { platinum: { rarest: null, last: null } }, longestGame: { game: null },
    } as unknown as WrappedResponse;
    expect(slideCover('hours', d)?.title).toBe('A');
    expect(slideCover('finished', d)?.title).toBe('D');
    expect(slideCover('trophies', d)).toBeNull();
    expect(slideCover('longestGame', d)).toBeNull();
  });
});

import {
  allEstimateBadge, allRangeText, busiestBars, firstGameCaption, parseScopeParam, platinumRows, resolveSlides as resolveSlides26, yearsAgoText,
} from './model';

describe('Итоги «Всё время» (Фаза 26)', () => {
  it('параметр year: all, год, мусор', () => {
    expect(parseScopeParam('all')).toBe('all');
    expect(parseScopeParam('ALL')).toBeNull();
    expect(parseScopeParam('2025')).toBe(2025);
    expect(parseScopeParam('all2')).toBeNull();
    expect(parseScopeParam(null)).toBeNull();
  });
  it('новые слайды принимаются, порядок сервера сохраняется', () => {
    const slides = resolveSlides26({ mode: 'story', slides: ['start', 'firstGame', 'hours', 'platinumYears', 'busiestYear', 'genres', 'longestGame', 'playPattern', 'final'] });
    expect(slides).toEqual(['start', 'firstGame', 'hours', 'platinumYears', 'busiestYear', 'genres', 'longestGame', 'playPattern', 'final']);
  });
  it('в годовом наборе playPattern идёт после «Трофеев» и редких', () => {
    const slides = resolveSlides26({ mode: 'story', slides: ['start', 'trophies', 'playPattern', 'final'], trophies: { rare: [{}] } });
    expect(slides).toEqual(['start', 'trophies', 'rareTrophies', 'playPattern', 'final']);
  });
  it('диапазон лет', () => {
    const period = { from: '2014-05-01', to: '2026-10-01', fromUtc: null, toUtc: null };
    expect(allRangeText({ year: 2026, period, years: [{ year: 2026, hasData: true }] })).toBe('2014 – 2026');
    expect(allRangeText({ year: 2026, period: { ...period, from: null }, years: [{ year: 2026, hasData: true }, { year: 2019, hasData: true }, { year: 2018, hasData: false }] })).toBe('2019 – 2026');
  });
  it('подписи первой игры', () => {
    expect(firstGameCaption('first_played', '2014-03-12T09:00:00.000Z')).toBe('Первый запуск: 12 марта 2014');
    expect(firstGameCaption('first_trophy', '2014-03-12T09:00:00.000Z')).toBe('Первый трофей: 12 марта 2014');
    expect(firstGameCaption(null, null)).toBeNull();
    expect(yearsAgoText('2014-03-12T09:00:00.000Z', Date.parse('2026-10-31T00:00:00Z'))).toBe('12 лет назад');
    expect(yearsAgoText('2026-03-12T09:00:00.000Z', Date.parse('2026-10-31T00:00:00Z'))).toBe('меньше года назад');
  });
  it('плашка оценки: «Итог равен сумме» только без неотнесённых часов', () => {
    expect(allEstimateBadge('2026-03-04', 0)).toContain('Итог равен сумме PSN.');
    expect(allEstimateBadge('2026-03-04', 40)).not.toContain('равен сумме');
    expect(allEstimateBadge('2026-03-04', 40)).toMatch(/^Часы до 04\.03\.2026 оценены/);
  });
  it('платины: последние 8 лет, новые сверху, остаток', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ year: 2017 + i, count: i === 3 ? 0 : i + 1 }));
    const r = platinumRows(items);
    expect(r.rows).toHaveLength(8);
    expect(r.rows[0].year).toBe(2026);
    expect(r.rest).toBe(1);
    expect(r.rows[0].pct).toBe(100);
  });
  it('мини-столбцы: до 10 лет, лидер отмечен', () => {
    const by = Array.from({ length: 12 }, (_, i) => ({ year: 2015 + i, hours: i * 10 }));
    const b = busiestBars(by, 2026);
    expect(b).toHaveLength(10);
    expect(b.filter((x) => x.leader).map((x) => x.year)).toEqual([2026]);
  });
});
