// Только для тестов: подмена requireUser в route-тестах без cookie и БД. Подключение:
//   vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
// userId меняется через testSession.userId (тесты на изоляцию двух пользователей).
import { NextResponse } from 'next/server';
import { asUserId } from './user-id';

// loginId: основной профиль входа (Фаза 41); null = userId сам основной
export const testSession: { userId: number; role: 'owner' | 'member'; anonymous: boolean; loginId: number | null } = { userId: 1, role: 'owner', anonymous: false, loginId: null };

export function resetTestSession(): void {
  testSession.userId = 1;
  testSession.role = 'owner';
  testSession.anonymous = false;
  testSession.loginId = null;
}

const deny = () => ({
  ok: false as const,
  response: NextResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Требуется вход.' } }, { status: 401 }),
});

function authed() {
  if (testSession.anonymous) return deny();
  const id = asUserId(testSession.userId);
  const row = {
    id: testSession.userId, email: `u${testSession.userId}@example.com`, role: testSession.role, status: 'active', googleSub: null, displayName: null,
    psnOnlineId: testSession.role === 'owner' ? 'Target' : `psn${testSession.userId}`, psnAccountId: null, psnAccessMode: 'public', psnAccessStatus: 'ok',
    psnAccessCheckedAt: null, onboardedAt: null, tourVersion: null, tourCompletedAt: null, lastLoginAt: null, invitedBy: null, primaryUserId: testSession.loginId, archivedAt: null, sessionEpoch: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };
  return { ok: true as const, user: { id, loginId: asUserId(testSession.loginId ?? testSession.userId), email: row.email, role: testSession.role, profileRole: testSession.loginId === null ? testSession.role : ('member' as const), amr: 'google' as const, row } };
}

export const requireUserMock = {
  requireUser: async () => authed(),
  requireOwner: async () => {
    const r = authed();
    if (!r.ok) return r;
    return testSession.role === 'owner' ? r : { ok: false as const, response: NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'Недостаточно прав.' } }, { status: 403 }) };
  },
};
