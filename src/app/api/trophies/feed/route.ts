import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { parseFeedQuery } from '@/server/trophies/feed';
import { getTrophyFeed } from '@/server/trophies/feed-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// F3 «Лента трофеев» (контракт §24): GET ?period=7d|month|all&rare=0|1&cursor=&limit=
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseFeedQuery(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return okRevalidated(req, await getTrophyFeed(getDb(), a.user.id, p.value, new Date()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
