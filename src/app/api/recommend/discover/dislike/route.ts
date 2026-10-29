import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { dislikeExternal } from '@/server/recommend/discover-dislikes';
import { parseExternalDislikeBody } from '@/server/recommend/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Не интересно» для внешней игры. Идемпотентно, повтор продлевает срок. Контракт 19.7.
export async function POST(req: Request) {
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseExternalDislikeBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    await dislikeExternal(getDb(), p.value);
    return ok({ externalId: p.value.externalId });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
