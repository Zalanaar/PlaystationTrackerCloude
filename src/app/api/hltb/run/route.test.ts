import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runHltbMass = vi.fn();
vi.mock('@/db', () => ({ getDb: () => ({}) }));
vi.mock('@/server/sync/hltb-step', () => ({ defaultHltbDeps: () => ({}) }));
vi.mock('@/server/sync/hltb-run', () => ({ runHltbMass: (o: unknown) => runHltbMass(o) }));

import { POST } from './route';

const NOW = new Date('2026-10-28T10:00:00Z');
const req = (body: unknown) =>
  new Request('http://localhost/api/hltb/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/hltb/run: since', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    runHltbMass.mockReset();
    runHltbMass.mockResolvedValue({ kind: 'done', result: { processed: 0, found: 0, notFound: 0, failed: 0, remaining: 0, done: true, stopReason: 'complete' }, warnings: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('since в будущем (сверх 5 с) = 400 since_in_future, запуск не стартует', async () => {
    const res = await POST(req({ recheckNotFound: true, since: new Date(NOW.getTime() + 5001).toISOString() }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.code).toBe('invalid_request');
    expect(j.error.details).toEqual({ reason: 'since_in_future' });
    expect(runHltbMass).not.toHaveBeenCalled();
  });

  it('since в пределах допуска 5 с и в прошлом передаётся как есть, без обрезки до «сейчас»', async () => {
    for (const ms of [5000, 0, -60_000]) {
      const since = new Date(NOW.getTime() + ms);
      const res = await POST(req({ recheckNotFound: true, since: since.toISOString() }));
      expect(res.status).toBe(200);
      expect(runHltbMass.mock.calls.at(-1)![0].recheckBefore.getTime()).toBe(since.getTime());
    }
  });

  it('граница не растёт между вызовами', async () => {
    const since = new Date(NOW.getTime() + 3000).toISOString();
    await POST(req({ recheckNotFound: true, since }));
    vi.setSystemTime(new Date(NOW.getTime() + 2000));
    await POST(req({ recheckNotFound: true, since }));
    const [a, b] = runHltbMass.mock.calls.map((c) => c[0].recheckBefore.getTime());
    expect(a).toBe(b);
  });

  it('без since при recheckNotFound = 400; без перепроверки since игнорируется', async () => {
    expect((await POST(req({ recheckNotFound: true }))).status).toBe(400);
    const res = await POST(req({ since: '2999-01-01T00:00:00Z' }));
    expect(res.status).toBe(200);
    expect(runHltbMass.mock.calls.at(-1)![0].recheckBefore).toBeUndefined();
  });

  it('любая внутренняя ошибка = 503 db_unavailable', async () => {
    runHltbMass.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(req({}));
    expect(res.status).toBe(503);
  });
});
