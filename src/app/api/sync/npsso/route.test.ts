import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { defaultAuthApi, type TokenPair } from '@/server/psn/auth';
import { PsnError } from '@/server/psn/errors';
import { decryptToken } from '@/server/psn/crypto';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { POST } = await import('./route');
const { GET: statusGet } = await import('../status/route');

const pgc = (x: TestDb) => (x.pg as unknown as { $client: PGlite }).$client;
const KEY = Buffer.alloc(32, 7).toString('base64');
const NPSSO = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz01'.slice(0, 64);
const pair: TokenPair = { accessToken: 'access-secret-token-xyz', refreshToken: 'refresh-secret-token-xyz', expiresIn: 3600, refreshTokenExpiresIn: 864000 };

const req = (body: unknown, o: { headers?: Record<string, string>; raw?: string } = {}) =>
  new Request('http://x/api/sync/npsso', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'x', 'x-forwarded-for': '1.2.3.4', ...o.headers },
    body: o.raw ?? JSON.stringify(body),
  });

beforeAll(async () => {
  t = await createTestDb();
  await pgc(t).exec(`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await pgc(t).exec('TRUNCATE login_attempts');
  resetTestSession();
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Target');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', KEY);
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/sync/npsso', () => {
  it('owner: NPSSO обменян, токены зашифрованы, событие pasted, NPSSO нигде не хранится', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    const r = await POST(req({ npsso: NPSSO }));
    expect(r.status).toBe(200);
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.data.accepted).toBe(true);
    expect(body.data.token.lastEvent.event).toBe('pasted');
    expect(body.data.token.source).toBe('pasted');
    expect(ex).toHaveBeenCalledWith(NPSSO);
    for (const secret of [NPSSO, pair.accessToken, pair.refreshToken]) expect(text).not.toContain(secret);

    const [row] = (await pgc(t).query<{ refresh_token_enc: string; source: string }>('select * from psn_auth')).rows;
    expect(row.source).toBe('npsso');
    expect(row.refresh_token_enc).not.toContain('refresh-secret');
    expect(decryptToken(row.refresh_token_enc, KEY)).toBe(pair.refreshToken);
    const ev = (await pgc(t).query<{ event: string; user_id: number; details: unknown }>('select * from psn_token_events')).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event: 'pasted', user_id: 1 });
    // NPSSO нет ни в одной таблице, которая могла бы его принять
    const dump = JSON.stringify([ev, (await pgc(t).query('select * from login_attempts')).rows, (await pgc(t).query('select * from sync_runs')).rows, row]);
    expect(dump).not.toContain(NPSSO);
  });

  it('принимает JSON с ssocookie и кавычки', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    expect((await POST(req({ npsso: JSON.stringify({ npsso: NPSSO }) }))).status).toBe(200);
    expect((await POST(req({ npsso: `  "${NPSSO}" ` }))).status).toBe(200);
    expect(ex).toHaveBeenNthCalledWith(1, NPSSO);
    expect(ex).toHaveBeenNthCalledWith(2, NPSSO);
  });

  it('member: 403 без обращения к PSN; без сессии 401', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    testSession.role = 'member';
    testSession.userId = 2;
    const r = await POST(req({ npsso: NPSSO }));
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('forbidden');
    resetTestSession();
    testSession.anonymous = true;
    expect((await POST(req({ npsso: NPSSO }))).status).toBe(401);
    expect(ex).not.toHaveBeenCalled();
    expect((await pgc(t).query('select 1 from psn_auth')).rows).toHaveLength(0);
  });

  it('CSRF: чужой Origin и не-JSON Content-Type = 400, PSN не вызывается', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    expect((await POST(req({ npsso: NPSSO }, { headers: { origin: 'http://evil.example' } }))).status).toBe(400);
    expect((await POST(req({ npsso: NPSSO }, { headers: { 'content-type': 'text/plain' } }))).status).toBe(400);
    expect((await POST(req({ npsso: NPSSO }, { headers: { origin: 'http://x' } }))).status).toBe(200);
    expect(ex).toHaveBeenCalledTimes(1);
  });

  it('формат: мусор = 400 без PSN и без расхода лимита', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    for (const body of [{}, { npsso: 5 }, { npsso: 'short' }, { npsso: `${NPSSO}!` }, { npsso: '{"npsso":1}' }]) {
      const r = await POST(req(body));
      expect(r.status).toBe(400);
      expect((await r.json()).error.details).toEqual({ field: 'npsso' });
    }
    expect((await POST(req(null, { raw: 'not json' }))).status).toBe(400);
    expect(ex).not.toHaveBeenCalled();
    expect((await pgc(t).query('select 1 from login_attempts')).rows).toHaveLength(0);
  });

  it('config_error без TOKEN_ENCRYPTION_KEY', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    expect((await POST(req({ npsso: NPSSO }))).status).toBe(500);
  });

  it('отказ PSN: 422 npsso_invalid, прежние токены не стёрты, событие не пишется', async () => {
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValueOnce(pair);
    await POST(req({ npsso: NPSSO }));
    const before = (await pgc(t).query('select * from psn_auth')).rows;
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(null);
    const r = await POST(req({ npsso: NPSSO }));
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('npsso_invalid');
    expect((await pgc(t).query('select * from psn_auth')).rows).toEqual(before);
    expect((await pgc(t).query('select 1 from psn_token_events')).rows).toHaveLength(1);
  });

  it('лимит: 4-я неудача с IP = 429 с Retry-After; успех лимит не съедает; другой IP свободен', async () => {
    const ex = vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(null);
    for (let i = 0; i < 3; i++) expect((await POST(req({ npsso: NPSSO }))).status).toBe(422);
    const r = await POST(req({ npsso: NPSSO }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await r.json()).error.code).toBe('rate_limited');
    expect(ex).toHaveBeenCalledTimes(3);
    ex.mockResolvedValue(pair);
    expect((await POST(req({ npsso: NPSSO }, { headers: { 'x-forwarded-for': '9.9.9.9' } }))).status).toBe(200);
    // пароль не затронут
    expect((await pgc(t).query(`select 1 from login_attempts where kind = 'password'`)).rows).toHaveLength(0);
  });

  it('успехи не расходуют лимит', async () => {
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    for (let i = 0; i < 6; i++) expect((await POST(req({ npsso: NPSSO }))).status).toBe(200);
  });

  it('сбой PSN: 503 фиксированным текстом, NPSSO и токены не в ответе и не в логах, токены не стёрты', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockRejectedValue(new PsnError('psn_unavailable', `PSN: boom npsso=${NPSSO} Bearer ${pair.accessToken}`));
    const r = await POST(req({ npsso: NPSSO }));
    expect(r.status).toBe(503);
    const text = await r.text();
    expect(JSON.parse(text).error.code).toBe('psn_unavailable');
    expect(text).not.toContain(NPSSO);
    expect(text).not.toContain(pair.accessToken);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(NPSSO);
    expect((await pgc(t).query('select 1 from psn_auth')).rows).toHaveLength(0);
    expect((await pgc(t).query('select 1 from psn_token_events')).rows).toHaveLength(0);
  });

  it('неожиданное исключение (не PsnError) с NPSSO в тексте: ответ и логи чистые', async () => {
    const spies = (['log', 'error', 'warn'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockRejectedValue(new Error(`oops ${NPSSO}`));
    const r = await POST(req({ npsso: NPSSO }));
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain(NPSSO);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(NPSSO);
  });
});

describe('GET /api/sync/status: psnToken после вставки', () => {
  it('нет событий: psnToken = null; после вставки: возраст и последнее событие; баннер уходит', async () => {
    const empty = await (await statusGet(new Request('http://x/api/sync/status'))).json();
    expect(empty.data.psnToken).toBeNull();
    await pgc(t).exec(`insert into sync_runs (user_id, kind, status, error_reason, snapshot_date, started_at, finished_at) values (1, 'daily', 'failed', 'auth_expired', '2026-10-01', now() - interval '1 hour', now() - interval '1 hour')`);
    expect((await (await statusGet(new Request('http://x/api/sync/status'))).json()).data.psnAuth).toBe('auth_expired');
    vi.spyOn(defaultAuthApi, 'exchangeNpsso').mockResolvedValue(pair);
    await POST(req({ npsso: NPSSO }));
    const s = (await (await statusGet(new Request('http://x/api/sync/status'))).json()).data;
    expect(s.psnAuth).toBe('ok');
    expect(s.psnToken).toMatchObject({ source: 'pasted', lastEvent: { event: 'pasted' } });
    expect(s.psnToken.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(s)).not.toContain(NPSSO);
  });
});
