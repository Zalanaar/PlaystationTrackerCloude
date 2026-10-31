import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { NotFoundError, setGameHidden } from '@/server/collection/mutations';
import { getGamesByIds } from '@/server/collection/query';
import { parseGameId, parseHiddenBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скрытие игры из коллекции (мягкое удаление). Контракт 9.7.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseHiddenBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const db = getDb();
    await setGameHidden(db, a.user.id, id, p.value.hidden);
    const [game] = await getGamesByIds(db, a.user.id, [id]);
    return ok({ game });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
