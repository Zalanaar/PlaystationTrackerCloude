import { describe, expect, it } from 'vitest';
import { accessErrorText, confirmMatches, isEmailLike, loginErrorText, rowActions } from './model';

describe('loginErrorText', () => {
  it('известные коды', () => {
    expect(loginErrorText('access_denied')).toContain('обратитесь к владельцу');
    expect(loginErrorText('oauth_failed')).toBeTruthy();
    expect(loginErrorText('rate_limited')).toBeTruthy();
  });
  it('неизвестный и пустой код не показываются', () => {
    expect(loginErrorText('<script>')).toBeNull();
    expect(loginErrorText(null)).toBeNull();
  });
});

describe('accessErrorText', () => {
  it('коды контракта 22.5', () => {
    expect(accessErrorText(409, 'multiuser_not_ready')).toBe('Добавление участников пока отключено.');
    for (const c of ['user_exists', 'user_limit', 'owner_protected', 'not_blocked', 'confirm_mismatch']) {
      expect(accessErrorText(409, c)).not.toMatch(/[a-z_]{6,}/);
    }
  });
  it('по статусу', () => {
    expect(accessErrorText(0, 'network')).toBe('Нет связи с сервером.');
    expect(accessErrorText(500, 'x')).toContain('Не удалось');
  });
});

describe('rowActions', () => {
  it('владелец защищён', () => expect(rowActions({ role: 'owner', status: 'active' })).toEqual({ toggle: null, canDelete: false }));
  it('active: блок, без удаления', () => expect(rowActions({ role: 'member', status: 'active' })).toEqual({ toggle: 'block', canDelete: false }));
  it('blocked: разблок и удаление', () => expect(rowActions({ role: 'member', status: 'blocked' })).toEqual({ toggle: 'unblock', canDelete: true }));
  it('invited: блок и удаление', () => expect(rowActions({ role: 'member', status: 'invited' })).toEqual({ toggle: 'block', canDelete: true }));
});

describe('email', () => {
  it('проверка формата', () => {
    expect(isEmailLike(' A@b.co ')).toBe(true);
    expect(isEmailLike('abc')).toBe(false);
  });
  it('подтверждение удаления', () => {
    expect(confirmMatches(' Bob@X.io ', 'bob@x.io')).toBe(true);
    expect(confirmMatches('bob@x.com', 'bob@x.io')).toBe(false);
  });
});
