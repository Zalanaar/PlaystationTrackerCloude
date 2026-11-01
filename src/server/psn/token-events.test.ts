import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getAccessToken, type AuthApi, type TokenPair } from './auth';
import { PsnError } from './errors';
import { getTokenInfo, recordTokenEvent, REFRESHED_MIN_INTERVAL_MS, TOKEN_EVENTS_KEEP } from './token-events';

const KEY = Buffer.alloc(32, 3).toString('base64');
const pair = (n: string): TokenPair => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600, refreshTokenExpiresIn: 864000 });
const H = 3600_000;

describe('журнал токена PSN (контракт 27.3)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const events = async () => (await t.db.select().from(schema.psnTokenEvents)).sort((a, b) => a.id - b.id);
  const mkApi = (o: { npsso?: TokenPair | null; refresh?: TokenPair | null | Error } = {}): AuthApi => ({
    exchangeNpsso: vi.fn(async () => (o.npsso === undefined ? pair('npsso') : o.npsso)),
    exchangeRefresh: vi.fn(async () => {
      if (o.refresh instanceof Error) throw o.refresh;
      return o.refresh === undefined ? pair('refreshed') : o.refresh;
    }),
  });
  const cfg = { npsso: 'ENV-NPSSO-VALUE-1234', encryptionKey: KEY };
  const t0 = new Date('2026-10-27T10:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it('обмен NPSSO из env пишет from_env без секретов', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => t0 });
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event: 'from_env', userId: null, details: { refreshTokenExpiresInSec: 864000 } });
    expect(JSON.stringify(ev)).not.toContain('ENV-NPSSO');
  });

  it('refreshed не чаще раза в 20 часов', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => t0 });
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => at(2 * H), force: true });
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => at(4 * H), force: true });
    expect((await events()).map((e) => e.event)).toEqual(['from_env', 'refreshed']);
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => at(4 * H + REFRESHED_MIN_INTERVAL_MS), force: true });
    expect((await events()).map((e) => e.event)).toEqual(['from_env', 'refreshed', 'refreshed']);
  });

  it('протухание: expired один раз, повторы не дублируются; после новой вставки снова пишется', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => t0 });
    const dead = mkApi({ refresh: null, npsso: null });
    for (let i = 1; i <= 3; i++) {
      await expect(getAccessToken(t.db, cfg, { api: dead, now: () => at(i * 24 * H), force: true })).rejects.toBeInstanceOf(PsnError);
    }
    const ev = await events();
    expect(ev.map((e) => e.event)).toEqual(['from_env', 'expired']);
    expect(ev[1].details).toEqual({ reason: 'auth_expired', hadRefresh: true });
    await recordTokenEvent(t.db, 'pasted', { userId: 1, now: at(5 * 24 * H) });
    await expect(getAccessToken(t.db, cfg, { api: dead, now: () => at(20 * 24 * H), force: true })).rejects.toBeInstanceOf(PsnError);
    expect((await events()).map((e) => e.event)).toEqual(['from_env', 'expired', 'pasted', 'expired']);
  });

  it('временный сбой PSN события не пишет; нет токенов и нет NPSSO: события нет', async () => {
    await getAccessToken(t.db, cfg, { api: mkApi(), now: () => t0 });
    const flaky = mkApi({ refresh: new PsnError('psn_unavailable', 'x') });
    await expect(getAccessToken(t.db, cfg, { api: flaky, now: () => at(30 * H), force: true, backoffMs: [] })).rejects.toBeInstanceOf(PsnError);
    expect(await events()).toHaveLength(1);
    await t.reset();
    await expect(getAccessToken(t.db, { npsso: null, encryptionKey: KEY }, { api: mkApi(), now: () => t0 })).rejects.toBeInstanceOf(PsnError);
    expect(await events()).toHaveLength(0);
  });

  it('getTokenInfo: возраст от последнего pasted/from_env, lastEvent любой', async () => {
    expect(await getTokenInfo(t.db, t0)).toBeNull();
    await recordTokenEvent(t.db, 'from_env', { now: t0 });
    await recordTokenEvent(t.db, 'pasted', { userId: 1, now: at(2 * H) });
    await recordTokenEvent(t.db, 'refreshed', { now: at(30 * H), details: { refreshTokenExpiresInSec: 5 } });
    const r = (await getTokenInfo(t.db, at(50 * H)))!;
    expect(r.info).toMatchObject({ issuedAt: at(2 * H).toISOString(), ageSeconds: 48 * 3600, source: 'pasted' });
    expect(r.info.lastEvent).toMatchObject({ event: 'refreshed', at: at(30 * H).toISOString(), details: { refreshTokenExpiresInSec: 5 } });
    await recordTokenEvent(t.db, 'expired', { now: at(60 * H) });
    expect((await getTokenInfo(t.db, at(60 * H)))!.info.lastEvent?.event).toBe('expired');
  });

  it('хранятся последние 200 событий', async () => {
    for (let i = 0; i < TOKEN_EVENTS_KEEP + 5; i++) await recordTokenEvent(t.db, 'pasted', { now: at(i * 1000) });
    expect(await events()).toHaveLength(TOKEN_EVENTS_KEEP);
  });

  it('сбой записи (нет таблицы) не бросает', async () => {
    const broken = { insert: () => { throw new Error('no table'); }, select: () => { throw new Error('no table'); } } as unknown as typeof t.db;
    await expect(recordTokenEvent(broken, 'pasted')).resolves.toBeUndefined();
    expect(await getTokenInfo(broken)).toBeNull();
  });
});
