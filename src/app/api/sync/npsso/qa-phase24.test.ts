// QA Фазы 24: попытки сломать POST /api/sync/npsso (гонки, огромное тело, юникод, ssocookie, пустое, лимиты, логи).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { resetTestSession } from '@/server/auth/test-require-user';
import { defaultAuthApi, type TokenPair } from '@/server/psn/auth';
import { recordTokenEvent } from '@/server/psn/token-events';
import { PsnError } from '@/server/psn/errors';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { POST } = await import('./route');

const pgc = (x: TestDb) => (x.pg as unknown as { $client: PGlite }).$client;
const KEY = Buffer.alloc(32, 7).toString('base64');
const NPSSO = 'Zq8LmN2vXc4RtY6bHj1KdW3sPf5GaE7uIo9TnBr0VyCx2MeDl4QhSkAw6ZpJg8Uf'.slice(0, 64);
const pair: TokenPair = { accessToken: 'qa-access-secret', refreshToken: 'qa-refresh-secret', expiresIn: 3600, refreshTokenExpiresIn: 864000 };
const req = (body: unknown, o: { ip?: string; raw?: string } = {}) =>
  new Request('http://x/api/sync/npsso', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'x', 'x-forwarded-for': o.ip ?? '1.2.3.4' },
    body: o.raw ?? JSON.stringify(body),
  });

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await pgc(t).exec('TRUNCATE login_attempts');
  resetTestSession();
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Target');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', KEY);
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('QA 24: сломать вставку', () => {
  it('гонка: две одновременные вставки дают целую запись psn_auth и два события', async () => {
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    const rs = await Promise.all([POST(req({ npsso: NPSSO })), POST(req({ npsso: NPSSO }))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect((await pgc(t).query('select 1 from psn_auth')).rows).toHaveLength(1);
    expect((await pgc(t).query(`select 1 from psn_token_events where event = 'pasted'`)).rows).toHaveLength(2);
  });

  it('гонка: 6 параллельных неудач с одного IP, до PSN доходят ровно 3 (advisory lock)', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(null);
    const rs = await Promise.all(Array.from({ length: 6 }, () => POST(req({ npsso: NPSSO }))));
    expect(rs.filter((r) => r.status === 422)).toHaveLength(3);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(3);
    expect(ex).toHaveBeenCalledTimes(3);
  });

  it('глобальный лимит 10/час: с 4 IP по 3 неудачи 11-я заблокирована даже с нового IP', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(null);
    let n = 0;
    for (let ip = 1; ip <= 4; ip++) for (let i = 0; i < 3 && n < 10; i++, n++) await POST(req({ npsso: NPSSO }, { ip: `7.7.7.${ip}` }));
    expect(ex).toHaveBeenCalledTimes(10);
    const r = await POST(req({ npsso: NPSSO }, { ip: '8.8.8.8' }));
    expect(r.status).toBe(429);
    expect(ex).toHaveBeenCalledTimes(10);
  });

  it('временный сбой PSN тоже считается неудачей: 3 сбоя, 4-я 429', async () => {
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockRejectedValue(new PsnError('psn_unavailable', 'x'));
    for (let i = 0; i < 3; i++) expect((await POST(req({ npsso: NPSSO }))).status).toBe(503);
    expect((await POST(req({ npsso: NPSSO }))).status).toBe(429);
  });

  it('счётчики password/google не затронуты, а строки password/google в login_attempts по-прежнему вставляются', async () => {
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(null);
    for (let i = 0; i < 4; i++) await POST(req({ npsso: NPSSO }));
    const { reserveLoginAttempt } = await import('@/server/auth/attempts');
    expect((await reserveLoginAttempt('h1', 'password')).limited).toBe(false);
    expect((await reserveLoginAttempt('h1', 'google')).limited).toBe(false);
    const kinds = (await pgc(t).query<{ kind: string }>('select distinct kind from login_attempts order by 1')).rows.map((r) => r.kind);
    expect(kinds).toEqual(['google', 'npsso', 'password']);
  });

  it('огромное тело (2 МБ): 400, PSN не вызывается, лимит не расходуется', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    const r = await POST(req({ npsso: 'A'.repeat(2_000_000) }));
    expect(r.status).toBe(400);
    expect(ex).not.toHaveBeenCalled();
    expect((await pgc(t).query('select 1 from login_attempts')).rows).toHaveLength(0);
  });

  it('юникод и подмены: полноширинные, кириллица, нулевая ширина, эмодзи, длинный хвост = 400', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    const bad = [
      'Ａ'.repeat(64), 'Я'.repeat(64), NPSSO.slice(0, 63) + '​', NPSSO.slice(0, 32) + '​' + NPSSO.slice(32, 63),
      NPSSO.slice(0, 63) + '😀', `${NPSSO}\n${NPSSO}`, NPSSO.slice(0, 32) + ' ' + NPSSO.slice(32, 63), NPSSO.slice(0, 63) + '\0',
      '%41'.repeat(64), `${NPSSO}${NPSSO}`,
    ];
    for (const b of bad) expect((await POST(req({ npsso: b }))).status, JSON.stringify(b)).toBe(400);
    expect(ex).not.toHaveBeenCalled();
  });

  it('ssocookie: вложенный JSON, массив, null, число, ключ в другом регистре, пустое, пробелы', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    for (const b of [{ npsso: '' }, { npsso: '   ' }, { npsso: null }, { npsso: [NPSSO] }, { npsso: { npsso: NPSSO } }, { NPSSO }, [], null, 5, '"x"',
      { npsso: `{"NPSSO":"${NPSSO}"}` }, { npsso: `{"npsso":["${NPSSO}"]}` }, { npsso: `{"npsso":"${NPSSO}"` }]) {
      expect((await POST(req(b))).status, JSON.stringify(b)).toBe(400);
    }
    expect((await POST(req(null, { raw: '' }))).status).toBe(400);
    expect(ex).not.toHaveBeenCalled();
    expect((await POST(req({ npsso: `{"npsso":"${NPSSO}","expires_in":1}` }))).status).toBe(200);
    expect(ex).toHaveBeenLastCalledWith(NPSSO);
  });

  it('NPSSO нигде: ни в логах при всех исходах, ни в таблицах', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso');
    ex.mockResolvedValueOnce(pair);
    ex.mockResolvedValueOnce(null);
    ex.mockRejectedValueOnce(new PsnError('rate_limited', `limit ${NPSSO}`));
    ex.mockRejectedValueOnce(new Error(`raw ${NPSSO}`));
    const out: string[] = [];
    for (let i = 0; i < 4; i++) out.push(await (await POST(req({ npsso: NPSSO }, { ip: `3.3.3.${i}` }))).text());
    await recordTokenEvent(t.db, 'expired', { details: { reason: 'auth_expired', hadRefresh: true } });
    const dump = JSON.stringify([out, spies.map((s) => s.mock.calls)]);
    expect(dump).not.toContain(NPSSO);
    for (const tbl of ['psn_auth', 'psn_token_events', 'login_attempts', 'sync_runs']) {
      expect(JSON.stringify((await pgc(t).query(`select * from ${tbl}`)).rows), tbl).not.toContain(NPSSO);
    }
    expect(JSON.stringify(out)).not.toContain(pair.refreshToken);
  });

  it('журнал: хранит не более 200 событий, expired не дублируется', async () => {
    for (let i = 0; i < 230; i++) await recordTokenEvent(t.db, 'pasted', { now: new Date(Date.UTC(2026, 0, 1, 0, i)), details: { refreshTokenExpiresInSec: 1 } });
    expect((await pgc(t).query('select count(*)::int as n from psn_token_events')).rows[0]).toEqual({ n: 200 });
    await recordTokenEvent(t.db, 'expired', { details: { reason: 'auth_expired', hadRefresh: true } });
    await recordTokenEvent(t.db, 'expired', { details: { reason: 'auth_expired', hadRefresh: true } });
    expect((await pgc(t).query(`select count(*)::int as n from psn_token_events where event = 'expired'`)).rows[0]).toEqual({ n: 1 });
  });
});
