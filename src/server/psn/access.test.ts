// Проверка доступа к профилю (контракт 22.13): классификация ответов PSN без сети.
import { describe, expect, it, vi } from 'vitest';
import { checkProfileAccess, PSN_ONLINE_ID_RE, type AccessApi } from './access';

const TOKEN = 't'.repeat(40);
const okProfile = { profile: { accountId: '111' } };

function api(over: Partial<Record<keyof AccessApi, () => unknown>> = {}): AccessApi {
  return {
    getProfileFromUserName: vi.fn(over.getProfileFromUserName ?? (async () => okProfile)),
    getUserPlayedGames: vi.fn(over.getUserPlayedGames ?? (async () => ({ titles: [], totalItemCount: 0 }))),
    getUserTitles: vi.fn(over.getUserTitles ?? (async () => ({ trophyTitles: [], totalItemCount: 0 }))),
  } as unknown as AccessApi;
}
const deps = (a: AccessApi, getAccessToken = vi.fn(async () => TOKEN)) => ({ getAccessToken, api: a, secrets: [TOKEN] });

describe('checkProfileAccess', () => {
  it('профиль, игры и трофеи читаются: ok и accountId', async () => {
    expect(await checkProfileAccess(deps(api()), 'SomeUser')).toEqual({ status: 'ok', accountId: '111' });
  });

  it('профиля нет (404 / user not found / пустой ответ): not_found', async () => {
    for (const fn of [async () => { throw new Error('User not found'); }, async () => { throw new Error('Request failed with status 404'); }, async () => ({ profile: {} })]) {
      expect(await checkProfileAccess(deps(api({ getProfileFromUserName: fn })), 'x')).toEqual({ status: 'not_found' });
    }
  });

  it('профиль найден, а игры или трофеи закрыты (403): private; 404 на данных тоже private', async () => {
    const denied = async () => { throw new Error('Access denied 403'); };
    expect(await checkProfileAccess(deps(api({ getUserPlayedGames: denied })), 'x')).toEqual({ status: 'private' });
    expect(await checkProfileAccess(deps(api({ getUserTitles: denied })), 'x')).toEqual({ status: 'private' });
    expect(await checkProfileAccess(deps(api({ getUserTitles: async () => { throw new Error('Resource not found'); } })), 'x')).toEqual({ status: 'private' });
  });

  it('403 на самом профиле (закрытый профиль): private', async () => {
    expect(await checkProfileAccess(deps(api({ getProfileFromUserName: async () => { throw new Error('Forbidden'); } })), 'x')).toEqual({ status: 'private' });
  });

  it('лимит, сбой сервера и неизвестная ошибка: unavailable, с причиной', async () => {
    const r = await checkProfileAccess(deps(api({ getProfileFromUserName: async () => { throw new Error('429 Too Many Requests'); } })), 'x');
    expect(r).toEqual({ status: 'unavailable', reason: 'rate_limited' });
    const r2 = await checkProfileAccess(deps(api({ getUserPlayedGames: async () => { throw new Error('socket hang up'); } })), 'x');
    expect(r2).toEqual({ status: 'unavailable', reason: 'psn_unavailable' });
  });

  it('401 один раз обновляет токен и повторяет', async () => {
    let n = 0;
    const gat = vi.fn(async () => TOKEN);
    const a = api({
      getProfileFromUserName: async () => {
        if (n++ === 0) throw new Error('401 Unauthorized');
        return okProfile;
      },
    });
    expect(await checkProfileAccess(deps(a, gat), 'x')).toEqual({ status: 'ok', accountId: '111' });
    expect(gat).toHaveBeenNthCalledWith(2, true);
  });

  it('не удалось получить токен технического аккаунта: unavailable, секрет в результат не попадает', async () => {
    const r = await checkProfileAccess(deps(api(), vi.fn(async () => { throw new Error(`NPSSO ${TOKEN} rejected`); })), 'x');
    expect(r.status).toBe('unavailable');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('PSN_ONLINE_ID_RE', () => {
  it('3..16 символов, начинается с буквы', () => {
    for (const ok of ['abc', 'Artem_92', 'a-b_c', 'A'.repeat(16)]) expect(PSN_ONLINE_ID_RE.test(ok)).toBe(true);
    for (const bad of ['ab', 'A'.repeat(17), '1abc', '-abc', 'a b c', 'ник', 'a@b.c', '']) expect(PSN_ONLINE_ID_RE.test(bad)).toBe(false);
  });
});
