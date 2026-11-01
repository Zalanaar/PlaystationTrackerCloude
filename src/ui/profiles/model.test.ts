import { describe, expect, it } from 'vitest';
import {
  accessStatusText, addBlockedText, addErrorText, counterText, daysLeft, initialOf, isValidNick, nickMatches, profileMeta,
  purgeText, restoreErrorText, scopedKey, switchErrorText, unlinkErrorText,
} from './model';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1, 12);

describe('scopedKey', () => {
  it('с id и без', () => {
    expect(scopedKey('ps-view', 7)).toBe('ps-view:7');
    expect(scopedKey('ps-view', null)).toBe('ps-view');
  });
  it('разные профили дают разные ключи', () => expect(scopedKey('a', 1)).not.toBe(scopedKey('a', 2)));
});

describe('ник', () => {
  it('формат', () => {
    expect(isValidNick(' Artem_01 ')).toBe(true);
    expect(isValidNick('ab')).toBe(false);
    expect(isValidNick('1abc')).toBe(false);
    expect(isValidNick('a'.repeat(17))).toBe(false);
    expect(isValidNick('ник')).toBe(false);
  });
  it('подтверждение без регистра', () => {
    expect(nickMatches(' artem_01 ', 'Artem_01')).toBe(true);
    expect(nickMatches('', 'Artem_01')).toBe(false);
    expect(nickMatches('Artem', 'Artem_01')).toBe(false);
    expect(nickMatches('x', null)).toBe(false);
  });
  it('инициал', () => {
    expect(initialOf('artem')).toBe('A');
    expect(initialOf(null)).toBe('?');
  });
});

describe('архив', () => {
  it('ceil суток, минимум 1', () => {
    expect(daysLeft(new Date(NOW + 30 * DAY).toISOString(), NOW)).toBe(30);
    expect(daysLeft(new Date(NOW + 2.2 * DAY).toISOString(), NOW)).toBe(3);
    expect(daysLeft(new Date(NOW + DAY).toISOString(), NOW)).toBe(1);
  });
  it('менее суток и просрочено = сегодня', () => {
    expect(daysLeft(new Date(NOW + 5 * 3600_000).toISOString(), NOW)).toBeNull();
    expect(purgeText(new Date(NOW - 1000).toISOString(), NOW)).toBe('Архив: удалится сегодня');
  });
  it('склонение', () => {
    const at = (d: number) => purgeText(new Date(NOW + d * DAY).toISOString(), NOW);
    expect(at(1)).toBe('Архив: удалится через 1 день');
    expect(at(3)).toBe('Архив: удалится через 3 дня');
    expect(at(5)).toBe('Архив: удалится через 5 дней');
    expect(at(21)).toBe('Архив: удалится через 21 день');
  });
});

describe('тексты', () => {
  it('счётчик и мета', () => {
    expect(counterText(2, 3)).toBe('2 из 3');
    expect(profileMeta(0, null)).toBe('игр пока нет · синк ещё не было');
    expect(profileMeta(214, '2026-10-30T10:00:00Z')).toBe('214 игр · синк 30.10.2026');
  });
  it('accessStatus: ok молчит, остальное с текстом', () => {
    expect(accessStatusText('ok')).toBeNull();
    for (const s of ['not_found', 'private', 'friend_required', 'unavailable', 'unchecked', 'weird']) expect(accessStatusText(s)).toBeTruthy();
  });
  it('добавление: коды из спеки', () => {
    expect(addErrorText({ status: 400, code: 'invalid_request' }, 'x').field).toBe(true);
    expect(addErrorText({ status: 422, code: 'psn_not_found' }, 'Foo').text).toBe('Профиль «Foo» не найден в PSN. Проверь написание ника.');
    expect(addErrorText({ status: 429, code: 'rate_limited', retryAfterSec: 12 }, 'x').text).toBe('Слишком часто. Повтори через 12 с.');
    expect(addErrorText({ status: 503, code: 'psn_unavailable' }, 'x').retry).toBe(true);
    expect(addErrorText({ status: 409, code: 'profile_limit' }, 'x').toList).toBe(true);
    expect(addErrorText({ status: 500, code: 'config_error' }, 'x').text).toBe('Не удалось добавить профиль. Повтори позже.');
    expect(addErrorText({ status: 0, code: 'network' }, 'x').text).toBe('Нет связи. Проверь интернет и повтори.');
    expect(addErrorText({ status: 429, code: 'weird' }, 'x').text).toContain('Слишком часто');
  });
  it('psn_id_taken не раскрывает владельца', () => {
    expect(addErrorText({ status: 409, code: 'psn_id_taken' }, 'x').text).toContain('у вас или у другого пользователя');
  });
  it('возврат из архива', () => {
    expect(restoreErrorText({ status: 409, code: 'profile_limit' })).toContain('3 из 3');
    expect(restoreErrorText({ status: 500, code: 'x' })).toBe('Не удалось вернуть профиль. Повтори.');
  });
  it('отвязка', () => {
    expect(unlinkErrorText({ status: 400, code: 'confirm_mismatch' }, 'Foo', false)).toMatchObject({ field: true, text: 'Ник не совпал. Введите «Foo» точно.' });
    expect(unlinkErrorText({ status: 404, code: 'not_found' }, 'Foo', false).close).toBe(true);
    expect(unlinkErrorText({ status: 409, code: 'primary_protected' }, 'Foo', false).reload).toBe(true);
    expect(unlinkErrorText({ status: 500, code: 'x' }, 'Foo', true).text).toBe('Не удалось удалить профиль. Повтори.');
  });
  it('смена профиля', () => {
    expect(switchErrorText({ status: 404, code: 'not_found' })).toMatchObject({ retry: false, reload: true });
    expect(switchErrorText({ status: 0, code: 'network' })).toMatchObject({ retry: true, reload: false });
  });
  it('кнопка добавления: причины блокировки', () => {
    expect(addBlockedText(true, 1, 3)).toBeNull();
    expect(addBlockedText(false, 3, 3)).toContain('3 из 3');
    expect(addBlockedText(false, 1, 3)).toContain('общий лимит');
  });
});
