import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { dismissChecklist } from '@/server/checklist/checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П13.4: POST — скрыть «Первую неделю» насовсем (на всех устройствах).
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await dismissChecklist(getDb(), a.user.id, new Date());
    return ok({ dismissed: true });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
