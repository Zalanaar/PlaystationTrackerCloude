import { describe, expect, it } from 'vitest';
import {
  checkActions, checkFromStatus, deriveStep, gamesSeen, mapPutError, needsOnboarding, phaseLabel, progressPercent, retryAfterSeconds,
  isIdlePartial, isStalled, shouldAutoStart, shouldResumePartial, syncErrorText, syncView, validateNick, type SyncSlice,
} from './model';

describe('validateNick', () => {
  it('тексты ошибок по спеке', () => {
    expect(validateNick('')).toBe('Введите ник PSN');
    expect(validateNick('   ')).toBe('Введите ник PSN');
    expect(validateNick('ab')).toBe('Ник должен быть от 3 до 16 символов');
    expect(validateNick('a'.repeat(17))).toBe('Ник должен быть от 3 до 16 символов');
    expect(validateNick('1abc')).toBe('Ник должен начинаться с латинской буквы');
    expect(validateNick('Ник123')).toBe('Ник должен начинаться с латинской буквы');
    expect(validateNick('ab c')).toBe('Допустимы латинские буквы, цифры, «-» и «_»');
    expect(validateNick('ab.c')).toBe('Допустимы латинские буквы, цифры, «-» и «_»');
  });
  it('корректные ники и trim', () => {
    expect(validateNick('abc')).toBeNull();
    expect(validateNick(' Art_em-1 ')).toBeNull();
    expect(validateNick('a'.repeat(16))).toBeNull();
  });
});

describe('deriveStep / needsOnboarding', () => {
  it('шаг по данным', () => {
    expect(deriveStep({ onlineId: null, accessStatus: 'unchecked', onboardedAt: null, canStartSync: false })).toBe(1);
    expect(deriveStep({ onlineId: 'a', accessStatus: 'private', onboardedAt: null, canStartSync: false })).toBe(2);
    expect(deriveStep({ onlineId: 'a', accessStatus: 'ok', onboardedAt: null, canStartSync: true })).toBe(3);
    expect(deriveStep({ onlineId: 'a', accessStatus: 'ok', onboardedAt: '2026-10-30', canStartSync: true })).toBe(3);
  });
  it('редирект: владельца и неактивных не трогаем', () => {
    const m = { role: 'member', status: 'active', onlineId: 'a', onboardedAt: new Date() };
    expect(needsOnboarding(m)).toBe(false);
    expect(needsOnboarding({ ...m, onlineId: null })).toBe(true);
    expect(needsOnboarding({ ...m, onboardedAt: null })).toBe(true);
    expect(needsOnboarding({ ...m, role: 'owner', onboardedAt: null, onlineId: null })).toBe(false);
    expect(needsOnboarding({ ...m, status: 'blocked', onboardedAt: null })).toBe(false);
  });
});

describe('mapPutError', () => {
  it('коды -> состояния', () => {
    expect(mapPutError(422, 'psn_not_found').kind).toBe('psn_not_found');
    expect(mapPutError(422, 'psn_private').kind).toBe('psn_private');
    expect(mapPutError(422, 'psn_friend_required').kind).toBe('psn_friend_required');
    expect(mapPutError(409, 'psn_account_locked').kind).toBe('psn_account_locked');
    expect(mapPutError(409, 'psn_id_taken').kind).toBe('psn_id_taken');
    expect(mapPutError(503, 'psn_unavailable').kind).toBe('psn_unavailable');
    expect(mapPutError(500, 'config_error').kind).toBe('config_error');
    expect(mapPutError(400, 'invalid_request').kind).toBe('invalid');
    expect(mapPutError(503, 'db_unavailable').kind).toBe('network');
    expect(mapPutError(500, undefined).kind).toBe('network');
  });
  it('rate_limited: details, затем заголовок, затем 30', () => {
    expect(mapPutError(429, 'rate_limited', { retryAfterSec: 12 })).toEqual({ kind: 'rate_limited', retryAfterSec: 12 });
    expect(mapPutError(429, 'rate_limited', null, '7')).toEqual({ kind: 'rate_limited', retryAfterSec: 7 });
    expect(mapPutError(429, undefined, null, null)).toEqual({ kind: 'rate_limited', retryAfterSec: 30 });
    expect(retryAfterSeconds(0)).toBe(30);
    expect(retryAfterSeconds(9999)).toBe(300);
  });
  it('сохранённый статус и действия', () => {
    expect(checkFromStatus('private')?.kind).toBe('psn_private');
    expect(checkFromStatus('unchecked')).toBeNull();
    expect(checkActions('psn_account_locked')).toEqual({ primary: null, ghost: 'edit' });
    expect(checkActions('config_error')).toEqual({ primary: null, ghost: null });
    expect(checkActions('ok').primary).toBe('next');
  });
});

describe('синк (шаг 3)', () => {
  const run = (status: string, extra: Partial<NonNullable<SyncSlice['run']>> = {}): SyncSlice => ({ running: status === 'running', run: { status, ...extra } });
  it('вид и автозапуск', () => {
    expect(syncView(null).kind).toBe('idle');
    expect(syncView(run('running')).kind).toBe('running');
    expect(syncView(run('partial'))).toEqual({ kind: 'running', partial: true });
    expect(syncView(run('failed', { errorReason: 'timeout' }))).toEqual({ kind: 'failed', reason: 'timeout' });
    expect(syncView(run('success')).kind).toBe('success');
    expect(shouldAutoStart({ running: false, run: null })).toBe(true);
    expect(shouldAutoStart(run('failed'))).toBe(true);
    expect(shouldAutoStart(run('running'))).toBe(false);
    expect(shouldAutoStart(run('success'))).toBe(false);
    expect(shouldAutoStart(run('partial'))).toBe(true);
    expect(shouldAutoStart({ running: true, run: { status: 'partial' } })).toBe(false);
  });
  it('фазы, причины, прогресс, счётчик', () => {
    expect(phaseLabel('trophy_sets')).toBe(phaseLabel('trophy_link'));
    expect(phaseLabel('trophies')).toBe('Загружаем трофеи');
    expect(syncErrorText('timeout')).toContain('слишком много времени');
    expect(syncErrorText('npsso_invalid')).toBe(syncErrorText('auth_expired'));
    expect(syncErrorText('internal')).toBe('Неизвестная ошибка.');
    expect(progressPercent({ done: 5, total: 20 })).toBe(25);
    expect(progressPercent({ done: null, total: null })).toBeNull();
    expect(progressPercent({ done: 0, total: 0 })).toBeNull();
    expect(gamesSeen(run('success', { counters: { gamesSeen: 214 } }))).toBe(214);
    expect(gamesSeen(run('success', { counters: null }))).toBeNull();
  });
});

describe('возобновление partial', () => {
  it('isIdlePartial', () => {
    expect(isIdlePartial({ running: false, run: { status: 'partial' } })).toBe(true);
    expect(isIdlePartial({ running: true, run: { status: 'partial' } })).toBe(false);
    expect(isIdlePartial({ running: false, run: { status: 'failed' } })).toBe(false);
    expect(isIdlePartial(null)).toBe(false);
  });
  it('shouldResumePartial: 2 тика и кулдаун 30 с', () => {
    expect(shouldResumePartial(1, null, 0)).toBe(false);
    expect(shouldResumePartial(2, null, 0)).toBe(true);
    expect(shouldResumePartial(5, 1000, 20_000)).toBe(false);
    expect(shouldResumePartial(5, 1000, 31_000)).toBe(true);
  });
  it('isStalled: 3 минуты', () => {
    expect(isStalled(0, 179_999)).toBe(false);
    expect(isStalled(0, 180_000)).toBe(true);
  });
});
