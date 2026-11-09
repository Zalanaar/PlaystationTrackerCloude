import { describe, expect, it } from 'vitest';
import { isValidTimeZone, MSK_TZ, parseTzParam } from './tz';

describe('tz (Пакет 6, п. 3)', () => {
  it('принимает IANA-пояса', () => {
    for (const tz of ['Europe/Vilnius', 'Europe/Moscow', 'UTC', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3']) expect(isValidTimeZone(tz)).toBe(true);
  });
  it('отбрасывает мусор и попытки SQL-вставки', () => {
    for (const tz of ['', "Europe/Moscow'; drop table x;--", 'Mars/Olympus', '../etc', 'a'.repeat(80), null, 42, "x'"]) expect(isValidTimeZone(tz)).toBe(false);
  });
  it('parseTzParam: нет/мусор = Москва', () => {
    expect(parseTzParam(null)).toBe(MSK_TZ);
    expect(parseTzParam("'")).toBe(MSK_TZ);
    expect(parseTzParam('Europe/Vilnius')).toBe('Europe/Vilnius');
  });
});
