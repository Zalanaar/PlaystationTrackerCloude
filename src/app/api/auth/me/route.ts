import { ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Контракт 22.4.
export async function GET(req: Request) {
  const r = await requireUser(req);
  if (!r.ok) return r.response;
  const u = r.user.row;
  return ok({
    id: u.id,
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
