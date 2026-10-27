import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import * as authModule from './auth';
import { getAccessToken, type AuthApi, type TokenPair } from './auth';
import { PsnError } from './errors';
import { decryptToken } from './crypto';

const KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = new Date('2026-10-27T10:00:00Z');
const pair = (n: string, o: Partial<TokenPair> = {}): TokenPair => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresIn: 3600,
  refreshTokenExpiresIn: 864000,
  ...o,
});

describe('getAccessToken', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const mkApi = (o: { npsso?: TokenPair | null; refresh?: TokenPair | null | Error } = {}) => {
    const api: AuthApi = {
      exchangeNpsso: vi.fn(async () => (o.npsso === undefined ? pair('npsso') : o.npsso)),
      exchangeRefresh: vi.fn(async () => {
        if (o.refresh instanceof Error) throw o.refresh;
        return o.refresh === undefined ? pair('refreshed') : o.refresh;
      }),
    };
    return api;
  };
  const cfg = { npsso: 'NPSSO-VALUE-1234', encryptionKey: KEY };
  const stored = async () => (await t.db.select().from(schema.psnAuth))[0];

  it('первый запуск: обмен NPSSO, токены сохраняются зашифрованными', async () => {
    const api = mkApi();
    expect(await getAccessToken(t.db, cfg, { api, now: () => NOW })).toBe('access-npsso');
    const row = await stored();
    expect(row.source).toBe('npsso');
    expect(row.refreshTokenEnc).not.toContain('refresh-npsso');
    expect(row.accessTokenEnc).not.toContain('access-npsso');
    expect(decryptToken(row.refreshTokenEnc, KEY)).toBe('refresh-npsso');
    expect(row.refreshExpiresAt?.toISOString()).toBe('2026-11-06T10:00:00.000Z');
  });

  it('живой access token берётся из БД без обращения к PSN', async () => {
    const api = mkApi();
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    const later = new Date(NOW.getTime() + 30 * 60_000);
    expect(await getAccessToken(t.db, cfg, { api, now: () => later })).toBe('access-npsso');
    expect(api.exchangeRefresh).not.toHaveBeenCalled();
    expect(api.exchangeNpsso).toHaveBeenCalledTimes(1);
  });

  it('access истёк: refresh, новая пара (в том числе новый refresh) сохраняется', async () => {
    const api = mkApi();
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    expect(await getAccessToken(t.db, cfg, { api, now: () => later })).toBe('access-refreshed');
    expect(api.exchangeRefresh).toHaveBeenCalledWith('refresh-npsso');
    const row = await stored();
    expect(row.source).toBe('refresh');
    expect(decryptToken(row.refreshTokenEnc, KEY)).toBe('refresh-refreshed');
    expect(api.exchangeNpsso).toHaveBeenCalledTimes(1);
  });

  it('force игнорирует кэш access token', async () => {
    const api = mkApi();
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    expect(await getAccessToken(t.db, cfg, { api, now: () => NOW, force: true })).toBe('access-refreshed');
  });

  it('refresh отвергнут: запасной путь через NPSSO', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => NOW });
    const api = mkApi({ refresh: null, npsso: pair('new-npsso') });
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    expect(await getAccessToken(t.db, cfg, { api, now: () => later })).toBe('access-new-npsso');
  });

  it('refresh и NPSSO отвергнуты: auth_expired, данные auth не стёрты', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => NOW });
    const api = mkApi({ refresh: null, npsso: null });
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    await expect(getAccessToken(t.db, cfg, { api, now: () => later })).rejects.toMatchObject({ reason: 'auth_expired' });
    expect(await stored()).toBeDefined();
  });

  it('истёкший по сроку refresh не используется', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => NOW });
    const api = mkApi();
    const muchLater = new Date(NOW.getTime() + 11 * 86400_000);
    expect(await getAccessToken(t.db, cfg, { api, now: () => muchLater })).toBe('access-npsso');
    expect(api.exchangeRefresh).not.toHaveBeenCalled();
  });

  it('нет токенов и NPSSO отвергнут: npsso_invalid; NPSSO не задан: npsso_invalid', async () => {
    await expect(getAccessToken(t.db, cfg, { api: mkApi({ npsso: null }), now: () => NOW })).rejects.toMatchObject({ reason: 'npsso_invalid' });
    await expect(getAccessToken(t.db, { ...cfg, npsso: null }, { api: mkApi(), now: () => NOW })).rejects.toMatchObject({ reason: 'npsso_invalid' });
  });

  it('сетевая ошибка refresh не маскируется под auth_expired и не сжигает NPSSO', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => NOW });
    const net = Object.assign(new Error('fetch failed'), { reason: 'psn_unavailable' });
    const api = mkApi({ refresh: net });
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    await expect(getAccessToken(t.db, cfg, { api, now: () => later })).rejects.toThrow('fetch failed');
    expect(api.exchangeNpsso).not.toHaveBeenCalled();
  });

  it('смена ключа шифрования: старые токены игнорируются, идёт NPSSO', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => NOW });
    const other = { ...cfg, encryptionKey: Buffer.alloc(32, 9).toString('base64') };
    const api = mkApi();
    expect(await getAccessToken(t.db, other, { api, now: () => NOW })).toBe('access-npsso');
    expect(api.exchangeRefresh).not.toHaveBeenCalled();
  });
});

describe('defaultAuthApi: различение отказа и временного сбоя (fetch подменён)', () => {
  const tokens = { access_token: 'a-tok', refresh_token: 'r-tok', expires_in: 3600, refresh_token_expires_in: 864000 };
  const stub = (token: Response, authorize: Response = new Response(null, { status: 302, headers: { location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.abc' } })) =>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/token') ? token.clone() : authorize.clone())));
  afterEach(() => vi.unstubAllGlobals());
  const { defaultAuthApi } = authModule;

  it('успех: snake_case ответ превращается в пару', async () => {
    stub(new Response(JSON.stringify(tokens), { status: 200 }));
    expect(await defaultAuthApi.exchangeRefresh('r')).toMatchObject({ accessToken: 'a-tok', refreshToken: 'r-tok', refreshTokenExpiresIn: 864000 });
    expect(await defaultAuthApi.exchangeNpsso('n')).toMatchObject({ accessToken: 'a-tok' });
  });
  it('invalid_grant 400 = отказ (null)', async () => {
    stub(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    expect(await defaultAuthApi.exchangeRefresh('r')).toBeNull();
  });
  it('429 = rate_limited, 503 = psn_unavailable, оба с телом JSON', async () => {
    stub(new Response(JSON.stringify({ error: 'rate_limit' }), { status: 429 }));
    await expect(defaultAuthApi.exchangeRefresh('r')).rejects.toMatchObject({ reason: 'rate_limited' });
    stub(new Response(JSON.stringify({ error: 'server_error' }), { status: 503 }));
    await expect(defaultAuthApi.exchangeRefresh('r')).rejects.toMatchObject({ reason: 'psn_unavailable' });
  });
  it('200 без токенов и без признака отказа = временный сбой, не отказ', async () => {
    stub(new Response(JSON.stringify({}), { status: 200 }));
    await expect(defaultAuthApi.exchangeRefresh('r')).rejects.toMatchObject({ reason: 'psn_unavailable' });
  });
  it('/authorize: 302 без code = NPSSO отвергнут; 429 и 5xx = временный сбой', async () => {
    stub(new Response(JSON.stringify(tokens)), new Response(null, { status: 302, headers: { location: 'https://x/login' } }));
    expect(await defaultAuthApi.exchangeNpsso('n')).toBeNull();
    stub(new Response(JSON.stringify(tokens)), new Response(null, { status: 429 }));
    await expect(defaultAuthApi.exchangeNpsso('n')).rejects.toMatchObject({ reason: 'rate_limited' });
    stub(new Response(JSON.stringify(tokens)), new Response(null, { status: 502 }));
    await expect(defaultAuthApi.exchangeNpsso('n')).rejects.toMatchObject({ reason: 'psn_unavailable' });
  });
  it('сеть: fetch бросает = psn_unavailable без секретов в тексте', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed for refresh-secret-value'); }));
    const e = await defaultAuthApi.exchangeRefresh('refresh-secret-value').catch((x: unknown) => x);
    expect(e).toMatchObject({ reason: 'psn_unavailable' });
    expect((e as Error).message).not.toContain('refresh-secret-value');
  });
});

describe('getAccessToken: повторы временных сбоев', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const cfg = { npsso: 'NPSSO-VALUE-1234', encryptionKey: KEY };

  it('429 дважды, затем успех: повторы с паузами, NPSSO не трогается', async () => {
    const refresh = vi
      .fn<(r: string) => Promise<TokenPair | null>>()
      .mockRejectedValueOnce(new PsnError('rate_limited', 'x'))
      .mockRejectedValueOnce(new PsnError('rate_limited', 'x'))
      .mockResolvedValueOnce(pair('second'));
    const api: AuthApi = { exchangeNpsso: vi.fn(async () => pair('npsso')), exchangeRefresh: refresh };
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    const sleep = vi.fn(async () => undefined);
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    expect(await getAccessToken(t.db, cfg, { api, now: () => later, sleep })).toBe('access-second');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(api.exchangeNpsso).toHaveBeenCalledTimes(1);
  });

  it('постоянный 5xx: после повторов psn_unavailable, не auth_expired', async () => {
    const api: AuthApi = { exchangeNpsso: vi.fn(async () => { throw new PsnError('psn_unavailable', 'x'); }), exchangeRefresh: vi.fn(async () => null) };
    const sleep = vi.fn(async () => undefined);
    await expect(getAccessToken(t.db, cfg, { api, now: () => NOW, sleep })).rejects.toMatchObject({ reason: 'psn_unavailable' });
    expect(api.exchangeNpsso).toHaveBeenCalledTimes(3);
  });
});
