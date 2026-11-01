import { describe, expect, it } from 'vitest';
import {
  EMPTY_STORED, SNOOZE_DAYS, addVisit, canShowInstall, canShowManual, dismissOnce, isIosDevice, isIpad, isPathAllowed, markDone,
  parseCount, parseSnooze, parseStored, platformFor, storageAllows, type EligibilityInput, type InstallStored,
} from './install-model';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1, 12);
const ok: InstallStored = { ...EMPTY_STORED, visits: 2 };
const base: EligibilityInput = {
  stored: ok, now: NOW, standalone: false, mobile: true, pathname: '/', platform: 'android',
  tourActive: false, overlayOpen: false, conflictOpen: false, shownThisSession: false,
};

describe('install: разбор хранилища', () => {
  it('мусор не ломает', () => {
    expect(parseCount('abc')).toBe(0);
    expect(parseCount('-1')).toBe(0);
    expect(parseCount(null)).toBe(0);
    expect(parseCount('3')).toBe(3);
    expect(parseSnooze('нет')).toBeNull();
    expect(parseSnooze(null)).toBeNull();
    expect(parseSnooze('2026-11-15T00:00:00.000Z')).toBe(Date.UTC(2026, 10, 15));
    expect(parseStored({ done: '0' })).toEqual(EMPTY_STORED);
    expect(parseStored({ done: '1', visits: '4', dismissals: '2' })).toMatchObject({ done: true, visits: 4, dismissals: 2 });
  });
});

describe('install: закрытия и snooze', () => {
  it('1-е закрытие: 14 дней, 2-е: 60 дней, 3-е: навсегда', () => {
    expect(SNOOZE_DAYS).toEqual([14, 60]);
    const a = dismissOnce(ok, NOW);
    expect(a).toMatchObject({ dismissals: 1, done: false, snoozeUntil: NOW + 14 * DAY });
    const b = dismissOnce(a, NOW);
    expect(b).toMatchObject({ dismissals: 2, done: false, snoozeUntil: NOW + 60 * DAY });
    const c = dismissOnce(b, NOW);
    expect(c).toMatchObject({ dismissals: 3, done: true, snoozeUntil: null });
    expect(dismissOnce(c, NOW).done).toBe(true);
  });
  it('snooze действует до истечения', () => {
    const s = dismissOnce(ok, NOW);
    expect(storageAllows(s, NOW + 13 * DAY)).toBe(false);
    expect(storageAllows(s, NOW + 14 * DAY)).toBe(true);
  });
  it('done блокирует навсегда', () => {
    expect(storageAllows(markDone(ok), NOW + 999 * DAY)).toBe(false);
  });
});

describe('install: визиты', () => {
  it('показ не раньше второго визита', () => {
    expect(storageAllows(EMPTY_STORED, NOW)).toBe(false);
    expect(storageAllows(addVisit(EMPTY_STORED), NOW)).toBe(false);
    expect(storageAllows(addVisit(addVisit(EMPTY_STORED)), NOW)).toBe(true);
  });
});

describe('install: платформа', () => {
  it('iOS по UA, iPadOS как Macintosh с тачем', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(isIosDevice({ userAgent: iphone })).toBe(true);
    expect(isIosDevice({ userAgent: mac, maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' })).toBe(false);
    expect(isIpad({ userAgent: iphone })).toBe(false);
    expect(isIpad({ userAgent: mac, maxTouchPoints: 5 })).toBe(true);
  });
  it('Android только с событием; без него и не iOS нельзя', () => {
    expect(platformFor({ ios: false, hasPrompt: true })).toBe('android');
    expect(platformFor({ ios: true, hasPrompt: false })).toBe('ios');
    expect(platformFor({ ios: false, hasPrompt: false })).toBeNull();
  });
});

describe('install: canShowInstall', () => {
  it('базовый случай разрешён', () => expect(canShowInstall(base)).toBe(true));
  it.each([
    ['standalone', { standalone: true }],
    ['десктоп', { mobile: false }],
    ['нет платформы', { platform: null }],
    ['тур', { tourActive: true }],
    ['открыто окно', { overlayOpen: true }],
    ['Что нового / тосты / панель выбора', { conflictOpen: true }],
    ['первый визит', { stored: { ...EMPTY_STORED, visits: 1 } }],
    ['done', { stored: { ...ok, done: true } }],
    ['snooze', { stored: { ...ok, snoozeUntil: NOW + DAY } }],
  ] as [string, Partial<EligibilityInput>][])('не показывается: %s', (_n, patch) => {
    expect(canShowInstall({ ...base, ...patch })).toBe(false);
  });
  it.each(['/login', '/onboarding', '/wrapped', '/wrapped/2025', '/triage'])('не показывается на %s', (pathname) => {
    expect(isPathAllowed(pathname)).toBe(false);
    expect(canShowInstall({ ...base, pathname })).toBe(false);
  });
  it('обычные страницы разрешены', () => {
    for (const p of ['/', '/stats', '/backlog', '/triagex']) expect(isPathAllowed(p)).toBe(true);
  });
  it('без localStorage: один раз за сессию', () => {
    expect(canShowInstall({ ...base, stored: null })).toBe(true);
    expect(canShowInstall({ ...base, stored: null, shownThisSession: true })).toBe(false);
  });
});

describe('install: ручной вызов', () => {
  it('игнорирует snooze, визиты и done, но не standalone и платформу', () => {
    const m = { standalone: false, mobile: true, platform: 'ios' as const, pathname: '/' };
    expect(canShowManual(m)).toBe(true);
    expect(canShowManual({ ...m, standalone: true })).toBe(false);
    expect(canShowManual({ ...m, platform: null })).toBe(false);
    expect(canShowManual({ ...m, pathname: '/wrapped' })).toBe(false);
  });
});
