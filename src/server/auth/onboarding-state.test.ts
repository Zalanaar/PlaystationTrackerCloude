import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: null as unknown, psn: null as unknown, req: null as Request | null }));
vi.mock('@/db', () => ({ getDb: () => ({}) }));
vi.mock('./require-user', () => ({ requireUser: async (r: Request) => { m.req = r; return m.auth; } }));
vi.mock('./psn-access', () => ({ getPsnState: async () => { if (m.psn instanceof Error) throw m.psn; return m.psn; } }));
const { loadOnboardingState } = await import('./onboarding-state');

beforeEach(() => {
  m.auth = { ok: true, user: { id: 7, role: 'member' } };
  m.psn = { onlineId: 'Nick', onboardedAt: null };
});

describe('loadOnboardingState (P2-11)', () => {
  it('requireUser по cookie, затем состояние PSN', async () => {
    await expect(loadOnboardingState('ps_session=t')).resolves.toEqual({ role: 'member', onlineId: 'Nick', onboardedAt: null });
    expect(m.req!.headers.get('cookie')).toBe('ps_session=t');
  });
  it('null без cookie, без сессии, без профиля и при ошибке БД', async () => {
    await expect(loadOnboardingState(null)).resolves.toBeNull();
    m.auth = { ok: false };
    await expect(loadOnboardingState('c')).resolves.toBeNull();
    m.auth = { ok: true, user: { id: 7, role: 'member' } };
    m.psn = null;
    await expect(loadOnboardingState('c')).resolves.toBeNull();
    m.psn = new Error('db');
    await expect(loadOnboardingState('c')).resolves.toBeNull();
  });
});
