import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getTimeFit, parseMinutes } from '@/server/collection/time-fit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П12.5 (контракт «П12. У меня 2 часа»): GET ?minutes=120 — что успеть пройти за это время и что продолжить.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const minutes = parseMinutes(new URL(req.url).searchParams.get('minutes'));
  if (minutes === null) return fail(400, 'invalid_request', 'minutes: целое 15–600.');
  try {
    return okRevalidated(req, await getTimeFit(getDb(), a.user.id, minutes));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
