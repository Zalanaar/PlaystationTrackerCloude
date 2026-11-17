import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getChecklist } from '@/server/checklist/checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П13.4 (контракт «П13.4»): GET — «Первая неделя»: показывать ли и что уже сделано.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getChecklist(getDb(), a.user.id, new Date()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
