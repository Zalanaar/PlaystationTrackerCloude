import { describe, expect, it } from 'vitest';
import { buttonLabel, formatMoscow, needsNewNpsso, phaseText, progressFraction, reasonText, startErrorText, type SyncRun } from './status';

const run = (o: Partial<SyncRun> = {}): SyncRun => ({
  id: 1, kind: 'manual', status: 'running', phase: 'trophies', errorReason: null, errorMessage: null,
  startedAt: '2026-10-27T20:00:00.000Z', finishedAt: null, progress: null, counters: null, ...o,
});

describe('sync status mapping', () => {
  it('фаза с прогрессом n из m', () => {
    const r = run({ progress: { phase: 'trophies', step: 4, steps: 4, done: 40, total: 170 } });
    expect(phaseText(r)).toBe('Загрузка трофеев: 40 из 170');
    expect(progressFraction(r)).toBeCloseTo(40 / 170);
  });
  it('фаза без done/total показывает шаг', () => {
    const r = run({ progress: { phase: 'games', step: 1, steps: 4, done: null, total: null } });
    expect(phaseText(r)).toBe('Загрузка игр (шаг 1 из 4)');
    expect(progressFraction(r)).toBeNull();
  });
  it('причины ошибок по-русски', () => {
    for (const r of ['auth_expired', 'npsso_invalid', 'rate_limited', 'psn_unavailable', 'access_denied', 'timeout', 'internal'] as const) {
      expect(reasonText(r)).toMatch(/[а-яА-Я]/);
    }
    expect(reasonText(null)).toBe('');
  });
  it('NPSSO-баннер', () => {
    expect(needsNewNpsso({ psnAuth: 'auth_expired', run: null })).toBe(true);
    expect(needsNewNpsso({ psnAuth: 'ok', run: run({ status: 'failed', errorReason: 'npsso_invalid' }) })).toBe(true);
    expect(needsNewNpsso({ psnAuth: 'ok', run: run({ status: 'failed', errorReason: 'timeout' }) })).toBe(false);
    expect(needsNewNpsso({ psnAuth: 'auth_expired', run: run({ status: 'running' }) })).toBe(false);
  });
  it('название кнопки', () => {
    expect(buttonLabel({ run: null, running: false }, false)).toBe('Синк сейчас');
    expect(buttonLabel({ run: run({ status: 'partial' }), running: false }, false)).toBe('Продолжить синк');
    expect(buttonLabel({ run: run(), running: true }, false)).toBe('Синк идёт…');
  });
  it('время в Europe/Moscow', () => {
    expect(formatMoscow('2026-10-26T20:01:10.000Z')).toContain('23:01');
    expect(formatMoscow(null)).toBeNull();
    expect(formatMoscow('мусор')).toBeNull();
  });
  it('409 = уже идёт', () => {
    expect(startErrorText(409, 'sync_in_progress')).toBe('Синк уже идёт.');
    expect(startErrorText(500, 'config_error')).toMatch(/не настроен/);
  });
});
