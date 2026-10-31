import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { excludeGame, NotBacklogError, NotFoundError } from '@/server/roadmap/db';
import { parseExclusionBody } from '@/server/roadmap/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Убрать игру бэклога из плана («Не распределено»). Идемпотентно. Контракт 17.12.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseExclusionBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    await excludeGame(getDb(), a.user.id, p.value);
    return ok({ excluded: true, gameId: p.value });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof NotBacklogError) return fail(400, 'invalid_request', 'В план входят только игры со статусом «Бэклог».', { reason: 'not_backlog' });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
