import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { dislikeGame, NotFoundError } from '@/server/recommend/db';
import { parseDislikeBody } from '@/server/recommend/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Не интересно». Идемпотентно. Контракт 18.5.
export async function POST(req: Request) {
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseDislikeBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    await dislikeGame(getDb(), p.value);
    return ok({ gameId: p.value });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
