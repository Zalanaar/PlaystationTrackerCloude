import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuthMe, ME_FAIL_REUSE_MS, ME_REUSE_MS, resetAuthMeCache } from './authMe';
import { resetClientCaches } from '../profiles/scope';

const okBody = (role: string) => new Response(JSON.stringify({ ok: true, data: { id: 1, role } }), { status: 200 });

beforeEach(() => { resetAuthMeCache(); vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fetchAuthMe (P2-5: один запрос на загрузку)', () => {
  it('одновременные и чуть более поздние вызовы делят один запрос', async () => {
    const f = vi.fn(async () => okBody('owner'));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([fetchAuthMe(), fetchAuthMe()]);
    vi.setSystemTime(Date.now() + 300); // компонент под Suspense смонтировался позже
    const c = await fetchAuthMe();
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(c?.json?.data?.role).toBe('owner');
  });
  it('после ME_REUSE_MS, с fresh и после смены профиля — новый запрос', async () => {
    const f = vi.fn(async () => okBody('member'));
    vi.stubGlobal('fetch', f);
    await fetchAuthMe();
    vi.setSystemTime(Date.now() + ME_REUSE_MS + 1);
    await fetchAuthMe();
    expect(f).toHaveBeenCalledTimes(2);
    await fetchAuthMe({ fresh: true });
    expect(f).toHaveBeenCalledTimes(3);
    resetClientCaches();
    await fetchAuthMe();
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('401 и сбой сети: в той же загрузке общий ответ, после ME_FAIL_REUSE_MS — новый запрос', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockRejectedValueOnce(new Error('net')).mockResolvedValue(okBody('owner'));
    vi.stubGlobal('fetch', f);
    expect((await fetchAuthMe())?.status).toBe(401);
    vi.setSystemTime(Date.now() + 100); // второй хук смонтировался после ответа-ошибки (флак collection-requests)
    expect((await fetchAuthMe())?.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + ME_FAIL_REUSE_MS + 1);
    expect(await fetchAuthMe()).toBeNull();
    vi.setSystemTime(Date.now() + ME_FAIL_REUSE_MS + 1);
    expect((await fetchAuthMe())?.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('сбой не держится дольше ME_FAIL_REUSE_MS и обходится fresh', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValue(okBody('owner'));
    vi.stubGlobal('fetch', f);
    expect((await fetchAuthMe())?.status).toBe(503);
    expect((await fetchAuthMe({ fresh: true }))?.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
