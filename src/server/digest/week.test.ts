// Границы недели по МСК (UTC+3) и выбор целевой недели.
import { describe, expect, it } from 'vitest';
import { digestKind, digestTarget, mskWeekday, weekByMonday, weekOf } from './week';

describe('weekOf / weekByMonday', () => {
  it('границы: пн 00:00 МСК = вс 21:00 UTC, следующий пн 00:00 МСК исключается', () => {
    const w = weekOf(new Date('2026-10-25T16:00:00Z')); // вс 19:00 МСК
    expect(w.from).toBe('2026-10-19');
    expect(w.to).toBe('2026-10-25');
    expect(w.fromUtc.toISOString()).toBe('2026-10-18T21:00:00.000Z');
    expect(w.toUtc.toISOString()).toBe('2026-10-25T21:00:00.000Z');
    expect(w.prevFrom).toBe('2026-10-12');
    expect(w.prevTo).toBe('2026-10-18');
    expect(w.nextFrom).toBe('2026-10-26');
    expect(w.nextTo).toBe('2026-11-01');
  });
  it('вс 23:59 МСК ещё в неделе, пн 00:00 МСК уже в следующей', () => {
    expect(weekOf(new Date('2026-10-25T20:59:59Z')).from).toBe('2026-10-19');
    expect(weekOf(new Date('2026-10-25T21:00:00Z')).from).toBe('2026-10-26');
  });
  it('переход через границу года', () => {
    const w = weekByMonday('2026-12-28');
    expect(w.to).toBe('2027-01-03');
    expect(w.nextFrom).toBe('2027-01-04');
  });
});

describe('digestTarget', () => {
  it('воскресенье МСК: текущая неделя; суббота 23:30 МСК не день сводки', () => {
    expect(digestTarget(new Date('2026-10-25T16:00:00Z'))?.week.from).toBe('2026-10-19');
    expect(digestTarget(new Date('2026-10-24T20:30:00Z'))).toBeNull();
  });
  it('воскресенье 23:30 МСК (20:30 UTC) ещё воскресенье', () => {
    expect(mskWeekday(new Date('2026-10-25T20:30:00Z'))).toBe(0);
    expect(digestTarget(new Date('2026-10-25T20:30:00Z'))?.catchUp).toBe(false);
  });
  it('понедельник: догоняющая за прошлую неделю', () => {
    const t = digestTarget(new Date('2026-10-26T16:00:00Z'));
    expect(t?.catchUp).toBe(true);
    expect(t?.week.from).toBe('2026-10-19');
  });
  it('вторник-суббота: null; force: неделя now', () => {
    expect(digestTarget(new Date('2026-10-28T16:00:00Z'))).toBeNull();
    expect(digestTarget(new Date('2026-10-28T16:00:00Z'), true)?.week.from).toBe('2026-10-26');
  });
  it('ключ дедупа включает пользователя и понедельник', () => {
    expect(digestKind(7, '2026-10-19')).toBe('digest:7:2026-10-19');
  });
});
