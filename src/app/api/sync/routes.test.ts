import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as syncPost } from './route';
import { GET as cronGet } from '../cron/sync/route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const SECRET = 'c'.repeat(40);
const bearer = { authorization: `Bearer ${SECRET}` };

describe('API синка: защита и валидация (без PSN и БД)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('PSN_TARGET_ONLINE_ID', '');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('cron без Bearer или с неверным: 401', async () => {
    expect((await cronGet(new Request('http://x/api/cron/sync'))).status).toBe(401);
    expect((await cronGet(new Request('http://x/api/cron/sync', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
  });

  it('cron: некорректный continue = 400', async () => {
    const r = await cronGet(new Request('http://x/api/cron/sync?continue=abc', { headers: bearer }));
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('invalid_request');
  });

  it('cron без настроек PSN: 500 config_error (и без обращения к БД)', async () => {
    const r = await cronGet(new Request('http://x/api/cron/sync', { headers: bearer }));
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('config_error');
  });

  it('POST /api/sync требует application/json и совпадающий Origin', async () => {
    const noType = await syncPost(new Request('http://x/api/sync', { method: 'POST' }));
    expect(noType.status).toBe(400);
    const badOrigin = await syncPost(
      new Request('http://x/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example', host: 'x' } }),
    );
    expect(badOrigin.status).toBe(400);
  });

  it('POST /api/sync без настроек PSN: 500 config_error', async () => {
    const r = await syncPost(new Request('http://x/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('config_error');
  });
});

describe('cron continue: hop обязателен', () => {
  beforeEach(() => vi.stubEnv('CRON_SECRET', 'c'.repeat(40)));
  afterEach(() => vi.unstubAllEnvs());
  const h = { authorization: `Bearer ${'c'.repeat(40)}` };
  it('continue без hop, hop без continue, hop мусор = 400', async () => {
    for (const q of ['continue=5', 'hop=2', 'continue=5&hop=x', 'continue=5&hop=-1']) {
      expect((await cronGet(new Request(`http://x/api/cron/sync?${q}`, { headers: h }))).status).toBe(400);
    }
  });
});
