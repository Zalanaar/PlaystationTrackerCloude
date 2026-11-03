// QA 20.4: redirect-guard онбординга: владелец не редиректится, ошибки fail-open, member без ника/onboardedAt уходит на /onboarding.
// P2-11: состояние из серверного сервиса, без HTTP к себе.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type St = { role: 'owner' | 'member'; onlineId: string | null; onboardedAt: string | null } | null;
const state = vi.hoisted(() => ({ session: null as null | { role: string }, load: null as null | ((c: string | null) => Promise<St>) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'tok' }) }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/server/auth/session', () => ({ SESSION_COOKIE: 'ps_session', readSessionToken: async () => state.session }));
vi.mock('@/server/env', () => ({ getSessionSecret: () => 's'.repeat(40) }));
vi.mock('@/server/auth/onboarding-state', () => ({ loadOnboardingState: (c: string | null) => state.load!(c) }));

const { redirectToOnboardingIfNeeded } = await import('./onboarding-guard');
const loader = (s: St) => vi.fn(async () => s);

beforeEach(() => {
  state.session = { role: 'member' };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('self-fetch запрещён'); }));
});

describe('redirectToOnboardingIfNeeded', () => {
  it('владелец: сервис не вызывается, редиректа нет', async () => {
    state.session = { role: 'owner' };
    const l = loader({ role: 'owner', onlineId: null, onboardedAt: null });
    state.load = l;
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    expect(l).not.toHaveBeenCalled();
  });
  it('member без ника или без onboardedAt: редирект на /onboarding; cookie сессии передан сервису', async () => {
    const l = loader({ role: 'member', onlineId: null, onboardedAt: null });
    state.load = l;
    await expect(redirectToOnboardingIfNeeded()).rejects.toThrow('REDIRECT:/onboarding');
    expect(l).toHaveBeenCalledWith('ps_session=tok');
    state.load = loader({ role: 'member', onlineId: 'Nick_X', onboardedAt: null });
    await expect(redirectToOnboardingIfNeeded()).rejects.toThrow('REDIRECT:/onboarding');
  });
  it('member с ником и onboardedAt: без редиректа, без fetch', async () => {
    state.load = loader({ role: 'member', onlineId: 'Nick_X', onboardedAt: '2026-10-31T10:00:00Z' });
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fail-open: сервис вернул null или бросил, нет сессии', async () => {
    state.load = loader(null);
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    state.load = vi.fn(async () => { throw new Error('db'); });
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
    state.session = null;
    state.load = loader({ role: 'member', onlineId: null, onboardedAt: null });
    await expect(redirectToOnboardingIfNeeded()).resolves.toBeUndefined();
  });
});
