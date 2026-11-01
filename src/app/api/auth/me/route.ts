import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { listProfilesLight } from '@/server/auth/profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Контракт 22.4, Фаза 41 (41.3): id = активный профиль, role = роль входа, profiles для переключателя.
export async function GET(req: Request) {
  const r = await requireUser(req);
  if (!r.ok) return r.response;
  const u = r.user.row;
  let profiles;
  try {
    profiles = await listProfilesLight(getDb(), r.user.loginId);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
  return ok({
    id: u.id,
    loginId: r.user.loginId,
    activeProfileId: u.id,
    profiles,
    email: u.email,
    displayName: u.displayName,
    role: r.user.role,
    amr: r.user.amr,
    psn: {
      onlineId: u.psnOnlineId,
      accessMode: u.psnAccessMode,
      accessStatus: u.psnAccessStatus,
      checkedAt: u.psnAccessCheckedAt?.toISOString() ?? null,
    },
    onboardedAt: u.onboardedAt?.toISOString() ?? null,
  });
}
