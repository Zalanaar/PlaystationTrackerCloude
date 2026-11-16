import { describe, expect, it } from 'vitest';
import { shouldReport, toReport } from './errorReporter';

const O = 'https://ps.example';
describe('П10: журнал ошибок браузера (клиент)', () => {
  it('шум и чужие источники не отправляются', () => {
    const r = (message: string, source: string | null = null) => ({ kind: 'error' as const, message, source, stack: null });
    expect(shouldReport(r('Script error.'), O)).toBe(false);
    expect(shouldReport(r('ResizeObserver loop completed with undelivered notifications.'), O)).toBe(false);
    expect(shouldReport(r('AbortError: The operation was aborted.'), O)).toBe(false);
    expect(shouldReport(r('TypeError: x', 'chrome-extension://abc/x.js:1:1'), O)).toBe(false);
    expect(shouldReport(r('TypeError: x', 'https://cdn.other/x.js'), O)).toBe(false);
    expect(shouldReport(r('TypeError: x', '/_next/static/a.js:1:2'), O)).toBe(true);
    expect(shouldReport(r('  '), O)).toBe(false);
  });
  it('отчёт: имя и текст ошибки, файл без origin', () => {
    const e = new TypeError('boom');
    const rep = toReport({ kind: 'error', message: 'Uncaught TypeError: boom', filename: `${O}/_next/a.js`, lineno: 3, colno: 7, error: e }, O);
    expect(rep).toMatchObject({ kind: 'error', message: 'TypeError: boom', source: '/_next/a.js:3:7' });
    expect(toReport({ kind: 'rejection', reason: 'строка' }, O).message).toBe('строка');
    expect(toReport({ kind: 'rejection', reason: { a: 1 } }, O).message).toBe('[object Object]');
  });
});
