import { describe, expect, it } from 'vitest';
import {
  criteriaVerdict, criterionLabel, errorReasonLabel, formatAge, formatDateTime, healthErrorText, providerStateText, sourceText,
  syncLevel, tokenLevel, usageLevel, usageRatio, usageText,
} from './model';

const D = 86_400;

describe('tokenLevel', () => {
  it('пороги 7 и 10 дней', () => {
    expect(tokenLevel(0)).toBe('ok');
    expect(tokenLevel(7 * D - 1)).toBe('ok');
    expect(tokenLevel(7 * D)).toBe('warn');
    expect(tokenLevel(10 * D - 1)).toBe('warn');
    expect(tokenLevel(10 * D)).toBe('danger');
  });
  it('нет данных или мусор', () => {
    expect(tokenLevel(null)).toBe('unknown');
    expect(tokenLevel(undefined)).toBe('unknown');
    expect(tokenLevel(-5)).toBe('unknown');
    expect(tokenLevel(Number.NaN)).toBe('unknown');
  });
});

describe('formatAge', () => {
  it('единицы', () => {
    expect(formatAge(30)).toBe('0 мин');
    expect(formatAge(12 * 60)).toBe('12 мин');
    expect(formatAge(5 * 3600)).toBe('5 ч');
    expect(formatAge(10 * D)).toBe('10 дн.');
    expect(formatAge(9 * D + 4 * 3600)).toBe('9 дн. 4 ч');
    expect(formatAge(null)).toBe('нет данных');
  });
});

describe('formatDateTime', () => {
  it('Москва UTC+3, переход суток', () => {
    expect(formatDateTime('2026-11-01T10:05:00.000Z')).toBe('01.11.2026, 13:05');
    expect(formatDateTime('2026-10-31T22:30:00.000Z')).toBe('01.11.2026, 01:30');
  });
  it('пусто и мусор', () => {
    expect(formatDateTime(null)).toBe('нет');
    expect(formatDateTime('x')).toBe('нет');
  });
});

describe('syncLevel', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('нет синка = danger, до 36 ч ok, дольше warn', () => {
    expect(syncLevel(null, now)).toBe('danger');
    expect(syncLevel('2026-11-01T00:00:00Z', now)).toBe('ok');
    expect(syncLevel('2026-10-30T00:00:00Z', now)).toBe('warn');
  });
});

describe('потолки и расход', () => {
  it('выключено не выглядит безлимитом', () => {
    const t = providerStateText('llm', { state: 'disabled', reason: 'no_key', userLimit: 12, totalLimit: 60, userSource: 'default', totalSource: 'default' });
    expect(t).toContain('Выключено');
    expect(t).toContain('не выполняются');
    expect(usageText({ used: 2, limit: null }, { state: 'disabled' })).toBe('2 · выключено');
    expect(usageText({ used: 3, limit: 60 }, { state: 'active' })).toBe('3 из 60');
    expect(usageRatio({ used: 2, limit: null })).toBeNull();
  });
  it('уровни расхода', () => {
    expect(usageLevel({ used: 10, limit: 100 })).toBe('ok');
    expect(usageLevel({ used: 80, limit: 100 })).toBe('warn');
    expect(usageLevel({ used: 120, limit: 100 })).toBe('danger');
    expect(usageRatio({ used: 120, limit: 100 })).toBe(1);
  });
  it('clamped объясняется', () => {
    expect(sourceText('clamped')).toContain('приведено к границе');
    expect(sourceText('default')).toBeNull();
  });
});

describe('критерии', () => {
  it('вердикт', () => {
    expect(criteriaVerdict({ pass: 2, fail: 1, pending: 0, manual: 0 }).level).toBe('danger');
    expect(criteriaVerdict({ pass: 2, fail: 0, pending: 1, manual: 2 }).level).toBe('warn');
    expect(criteriaVerdict({ pass: 5, fail: 0, pending: 0, manual: 0 }).level).toBe('ok');
    expect(criteriaVerdict({ pass: 0, fail: 3, pending: 0, manual: 0 }).text).toContain('3 критерия не выполнены');
  });
  it('подписи', () => {
    expect(criterionLabel('pending')).toBe('Ждёт включения');
    expect(criterionLabel('manual')).toBe('Проверить вручную');
  });
});

describe('ошибки', () => {
  it('тексты', () => {
    expect(healthErrorText(403, 'forbidden')).toBe('Доступно только владельцу.');
    expect(healthErrorText(503, 'db_unavailable')).toContain('База данных');
    expect(healthErrorText(0, 'network')).toBe('Нет связи с сервером.');
    expect(errorReasonLabel(null)).toBe('причина не указана');
    expect(errorReasonLabel('auth_expired')).toBe('токен PSN устарел');
    expect(errorReasonLabel('weird')).toBe('другая ошибка');
  });
});
