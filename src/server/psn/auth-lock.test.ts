// Гонка обмена токенов (refresh ротируется): параллельные getAccessToken / вставка NPSSO не теряют рабочую пару.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getAccessToken, type AuthApi, type TokenPair } from './auth';
import { decryptToken } from './crypto';
import { pasteNpsso } from './npsso';

const KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = new Date('2026-10-27T10:00:00Z');
const LATER = new Date(NOW.getTime() + 2 * 3600_000);
const cfg = { npsso: 'NPSSO-VALUE-1234', encryptionKey: KEY };
const pair = (n: string): TokenPair => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600, refreshTokenExpiresIn: 864000 });
const tick = () => new Promise<void>((r) => setTimeout(r, 20));

/** PSN с ротацией: каждый refresh выдаёт новую пару, старый refresh после этого отвергается (null). */
function rotatingApi() {
  let current = 'refresh-npsso';
  let n = 0;
  const api: AuthApi = {
    exchangeNpsso: vi.fn(async () => pair('npsso')),
    exchangeRefresh: vi.fn(async (r: string) => {
      await tick();
      if (r !== current) return null;
      n += 1;
      const p = pair(`r${n}`);
      current = p.refreshToken;
      return p;
    }),
  };
  return api;
}

describe('getAccessToken под блокировкой', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const stored = async () => (await t.db.select().from(schema.psnAuth))[0];

  it('два параллельных вызова с истёкшим access: один refresh, оба получают свежий токен', async () => {
    const api = rotatingApi();
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    const [a, b] = await Promise.all([getAccessToken(t.db, cfg, { api, now: () => LATER }), getAccessToken(t.db, cfg, { api, now: () => LATER })]);
    expect([a, b]).toEqual(['access-r1', 'access-r1']);
    expect(api.exchangeRefresh).toHaveBeenCalledTimes(1);
    expect(api.exchangeNpsso).toHaveBeenCalledTimes(1); // только первичный обмен
    expect(decryptToken((await stored()).refreshTokenEnc, KEY)).toBe('refresh-r1');
  });

  it('параллельные force (оба получили 401): второй берёт пару первого, refresh не теряется', async () => {
    const api = rotatingApi();
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    const [a, b] = await Promise.all([getAccessToken(t.db, cfg, { api, now: () => NOW, force: true }), getAccessToken(t.db, cfg, { api, now: () => NOW, force: true })]);
    expect([a, b]).toEqual(['access-r1', 'access-r1']);
    expect(api.exchangeRefresh).toHaveBeenCalledTimes(1);
    // цепочка жива: следующий refresh принимается
    expect(await getAccessToken(t.db, cfg, { api, now: () => new Date(LATER.getTime() + 2 * 3600_000) })).toBe('access-r2');
  });

  it('вставка NPSSO во время refresh: новая пара не перезаписывается старой цепочкой', async () => {
    const api = rotatingApi();
    await getAccessToken(t.db, cfg, { api, now: () => NOW });
    const pasteApi: AuthApi = { exchangeNpsso: vi.fn(async () => pair('pasted')), exchangeRefresh: vi.fn(async () => null) };
    const refreshing = getAccessToken(t.db, cfg, { api, now: () => LATER });
    await tick();
    await pasteNpsso(t.db, { npsso: 'x'.repeat(64), encryptionKey: KEY, userId: 1, now: new Date(LATER.getTime() + 1000), api: pasteApi });
    expect(await refreshing).toBe('access-r1');
    // блокировка упорядочила записи: вставка идёт после завершения refresh и остаётся последней
    expect(decryptToken((await stored()).refreshTokenEnc, KEY)).toBe('refresh-pasted');
  });
});
