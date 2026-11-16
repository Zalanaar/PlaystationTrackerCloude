import { describe, expect, it } from 'vitest';
import { ageMap, ageSummary, ageText } from './backlogAge';

const NOW = Date.parse('2026-11-16T21:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('П12.4 возраст бэклога', () => {
  it('короткая запись возраста', () => {
    expect([0, 1, 13, 14, 60, 61, 200, 364, 365, 400, 800, 731].map(ageText)).toEqual(['сегодня', '1 дн.', '13 дн.', '2 нед.', '8 нед.', '2 мес.', '6 мес.', '11 мес.', '1 г.', '1 г. 1 мес.', '2 г. 2 мес.', '2 г.']);
  });
  it('сводка', () => {
    const a = { items: [], summary: { count: 3, medianDays: 400, overYear: 2, oldest: { gameId: 1, title: ' Cyberpunk 2077 ', since: ago(800) } } };
    expect(ageSummary(a, NOW)).toBe('Половина игр ждёт дольше 1 г. 1 мес. · дольше года — 2 · дольше всех — Cyberpunk 2077, 2 г. 2 мес.');
    expect(ageSummary({ items: [], summary: { count: 1, medianDays: 30, overYear: 0, oldest: { gameId: 1, title: 'X', since: ago(30) } } }, NOW)).toBe('Ждёт 4 нед.');
    expect(ageSummary({ items: [], summary: { count: 0, medianDays: null, overYear: 0, oldest: null } }, NOW)).toBeNull();
  });
  it('подписи строк', () => {
    const m = ageMap({ items: [{ gameId: 1, since: ago(200), source: 'status' }, { gameId: 2, since: ago(800), source: 'played' }, { gameId: 3, since: ago(0), source: 'status' }], summary: { count: 3, medianDays: 200, overYear: 1, oldest: null } }, NOW);
    expect([m.get(1), m.get(2), m.get(3)]).toEqual(['В бэклоге 6 мес.', 'Начата 2 г. 2 мес. назад', 'В бэклоге с сегодня']);
    expect(ageMap(null, NOW).size).toBe(0);
  });
});
