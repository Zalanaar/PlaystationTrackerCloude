// QA 20.4: redirect-guard онбординга: владелец не редиректится, ошибки fail-open, member без ника/onboardedAt уходит на /onboarding.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: null as null | { role: string }, host: 'app.example' as string | null }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'tok' }) }),
  headers: async () => ({ get: (k: string) => (k === 'host' ? state.host : null) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/server/auth/session', () => ({ SESSION_COOKIE: 'ps_session', readSessionToken: async () => state.session }));
vi.mock('@/server/env', () => ({ getSessionSecret: () => 's'.repeat(40) }));

const { redirectToOnboardingIfNeeded } = await import('./onboarding-guard');
const api = (data: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify({ ok: status === 200, data }), { status }));

beforeEach(() => {
  state.session = { role: 'member' };
  state.host = 'app.example';
});

describe('redirectToOnboardingIfNeeded', () => {
  it('владелец: API не вызывается, редиректа нет', async () => {
    state.session = { role: 'owner' };
    const f = api({ onlineId: null, onboardedAt: null });
    vi.stubGlobal('fetch', f);
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
  it('member без ника или без onboardedAt: редирект на /onboarding', async () => {
    vi.stubGlobal('fetch', api({ onlineId: null, onboardedAt: null }));
    await expect(redirectToOnboardingIfNeeded()).rejects.toThrow('REDIRECT:/onboarding');
    vi.stubGlobal('fetch', api({ onlineId: 'Nick_X', onboardedAt: null }));
    await expect(redirectToOnboardingIfNeeded()).rejects.toThrow('REDIRECT:/onboarding');
  });
  it('member с ником и onboardedAt: без редиректа', async () => {
    vi.stubGlobal('fetch', api({ onlineId: 'Nick_X', onboardedAt: '2026-10-31T10:00:00Z' }));
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
  });
  it('fail-open: 401/503, сеть, мусор, нет сессии, нет host', async () => {
    vi.stubGlobal('fetch', api(null, 401));
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    vi.stubGlobal('fetch', api(null, 503));
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    state.session = null;
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    state.session = { role: 'member' };
    state.host = null;
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
  });
});
