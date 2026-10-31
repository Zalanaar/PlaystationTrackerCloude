import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getRoadmap } from '@/server/roadmap/db';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Посчитанный план на лету. Контракт 17.5.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getRoadmap(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
