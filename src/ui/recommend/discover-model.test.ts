import { describe, expect, it } from 'vitest';
import { discoverView, generatedText, isStalePick, isUpcoming, pageHref, parseMode, platformsLine, releaseText, shownTotalText, stageIndex } from './model';

const NOW = Date.parse('2026-10-29T12:00:00.000Z'); // 15:00 МСК

describe('режимы «Подскажи» (13b)', () => {
  it('parseMode / pageHref: backlog не пишется, time только в бэклоге', () => {
    expect(parseMode('discover')).toBe('discover');
    expect(parseMode('backlog')).toBe('backlog');
    expect(parseMode('x')).toBe('backlog');
    expect(pageHref('discover', 'short')).toBe('/recommend?mode=discover');
    expect(pageHref('backlog', 'short')).toBe('/recommend?time=short');
    expect(pageHref('backlog', 'any')).toBe('/recommend');
  });
  it('generatedText: сегодня по МСК и другой день', () => {
    expect(generatedText('2026-10-29T10:00:00.000Z', NOW)).toBe('Подборка от сегодня, 13:00');
    expect(generatedText('2026-10-27T10:00:00.000Z', NOW)).toBe('Подборка от 27 октября');
    expect(generatedText(null, NOW)).toBeNull();
    expect(isStalePick('2026-10-27T10:00:00.000Z', NOW)).toBe(true);
    expect(isStalePick('2026-10-29T10:00:00.000Z', NOW)).toBe(false);
  });
  it('releaseText / isUpcoming', () => {
    expect(releaseText('2015-05-18')).toBe('18 мая 2015');
    expect(releaseText(null)).toBeNull();
    expect(releaseText('bad')).toBeNull();
    expect(isUpcoming('2027-01-01', NOW)).toBe(true);
    expect(isUpcoming('2015-05-18', NOW)).toBe(false);
    expect(isUpcoming(null, NOW)).toBe(false);
  });
  it('platformsLine: только PlayStation, новее первым, до 3', () => {
    expect(platformsLine(['PC', 'PlayStation 4', 'PlayStation 5', 'Xbox One'])).toBe('PS5 · PS4');
    expect(platformsLine(['PC', 'Nintendo Switch'])).toBeNull();
    expect(platformsLine(['PlayStation 3', 'PS Vita', 'PlayStation 4', 'PlayStation 5'])).toBe('PS5 · PS4 · PS3 · +1');
  });
  it('stageIndex и итог', () => {
    expect([0, 2999, 3000, 12000, 25000, 60000].map(stageIndex)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(shownTotalText(11, 15, 9)).toBe('Подтверждено в каталоге: 11 из 15; показано: 9');
    expect(shownTotalText(0, 0, 0)).toBeNull();
  });
  it('discoverView: приоритет disabled > catalog > limit > error > пусто', () => {
    const m = (llm: string, catalog = 'ok', verified = 3) => ({ items: [], meta: { llm, catalog, verified } });
    expect(discoverView({ items: [1], meta: { llm: 'disabled', catalog: 'ok', verified: 1 } })).toBe('cards');
    expect(discoverView(m('disabled', 'unavailable'))).toBe('disabled');
    expect(discoverView(m('ok', 'unavailable'))).toBe('catalog');
    expect(discoverView(m('limit'))).toBe('limit');
    expect(discoverView(m('error'))).toBe('error');
    expect(discoverView(m('ok'))).toBe('filtered');
    expect(discoverView(m('ok', 'ok', 0))).toBe('unverified');
  });
});
