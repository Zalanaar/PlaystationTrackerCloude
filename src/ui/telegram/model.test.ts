import { describe, expect, it } from 'vitest';
import { captionFor, countdownText, createErrorText, deriveView, formatLastSent, remainingMs, type TelegramStatus } from './model';

const base: TelegramStatus = { botConfigured: true, botUsername: 'bot', role: 'member', linked: false, linkedAt: null, deliversTo: 'none', lastSentAt: null, pendingCode: null };
const NOW = Date.parse('2026-11-01T10:00:00.000Z');
const future = '2026-11-01T10:10:00.000Z';
const past = '2026-11-01T09:59:00.000Z';

describe('deriveView', () => {
  it('загрузка без данных', () => expect(deriveView(null, null, false, NOW)).toBe('loading'));
  it('бот не настроен перекрывает всё', () => expect(deriveView({ ...base, botConfigured: false, linked: true, deliversTo: 'own_chat' }, null, false, NOW)).toBe('unavailable'));
  it('не подключено', () => expect(deriveView(base, null, false, NOW)).toBe('not_linked'));
  it('код ждёт (локальный)', () => expect(deriveView(base, { code: 'K7M2QX9H', expiresAt: future, deepLink: null }, false, NOW)).toBe('pending'));
  it('код ждёт (с сервера после перезагрузки)', () => expect(deriveView({ ...base, pendingCode: { expiresAt: future } }, null, false, NOW)).toBe('pending'));
  it('код истёк', () => expect(deriveView(base, { code: 'K7M2QX9H', expiresAt: past, deepLink: null }, false, NOW)).toBe('expired'));
  it('граница: ровно в момент истечения код истёк', () => expect(deriveView(base, { code: 'x', expiresAt: new Date(NOW).toISOString(), deepLink: null }, false, NOW)).toBe('expired'));
  it('подключено', () => expect(deriveView({ ...base, linked: true, deliversTo: 'own_chat' }, null, false, NOW)).toBe('linked'));
  it('подключено побеждает старый код', () => expect(deriveView({ ...base, linked: true, deliversTo: 'own_chat' }, { code: 'x', expiresAt: past, deepLink: null }, false, NOW)).toBe('linked'));
  it('владелец с чатом алертов', () => expect(deriveView({ ...base, role: 'owner', deliversTo: 'alerts_chat' }, null, false, NOW)).toBe('linked_owner'));
  it('ошибка создания', () => expect(deriveView(base, null, true, NOW)).toBe('create_error'));
});

describe('время', () => {
  it('countdown', () => {
    expect(countdownText(15 * 60 * 1000)).toBe('15:00');
    expect(countdownText(61_500)).toBe('01:02');
    expect(countdownText(-5)).toBe('00:00');
  });
  it('remainingMs', () => {
    expect(remainingMs(future, NOW)).toBe(600_000);
    expect(remainingMs(past, NOW)).toBe(0);
    expect(remainingMs(null, NOW)).toBe(0);
  });
  it('последняя отправка по часам устройства, без «МСК»', () => {
    expect(formatLastSent('2026-10-25T16:00:12.000Z', 'Europe/Moscow')).toBe('25 окт, 19:00');
    expect(formatLastSent('2026-10-25T16:00:12.000Z', 'Europe/Vilnius')).toBe('25 окт, 18:00');
  });
  it('нет даты', () => expect(formatLastSent(null)).toBeNull());
});

describe('тексты', () => {
  it('подключено: ещё не отправлялась', () => expect(captionFor('linked', null)).toContain('Ещё не отправлялась'));
  it('подключено: дата (по часам устройства, без «МСК»)', () => {
    const c = captionFor('linked', '2026-10-25T16:00:12.000Z');
    expect(c).toMatch(/Последняя: 2[56] окт, \d\d:00/);
    expect(c).not.toContain('МСК');
  });
  it('владелец', () => expect(captionFor('linked_owner', null)).toBe('Чат задан на сервере вместе с алертами.'));
  it('ошибки POST', () => {
    expect(createErrorText(429)).toContain('Слишком много');
    expect(createErrorText(503)).toContain('не настроен');
    expect(createErrorText(500)).toBe('Не получилось создать код. Попробуй ещё раз.');
  });
});
