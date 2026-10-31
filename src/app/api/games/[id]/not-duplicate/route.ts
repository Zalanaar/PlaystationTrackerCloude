import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { NotFoundError, setNotDuplicate } from '@/server/collection/mutations';
import { getGamesByIds } from '@/server/collection/query';
import { parseGameId } from '@/server/collection/validation';
import { fail, ok, originAllowed } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Это не дубль» (контракт 25.5): отвязывает версии и ставит not_duplicate = true. Тело необязательно: {"versionId": N}.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  let versionId: number | null = null;
  const raw = await req.text();
  if (raw.trim() !== '') {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'invalid_request', 'Тело запроса не JSON.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(400, 'invalid_request', 'Некорректное тело запроса.');
    const v = (body as { versionId?: unknown }).versionId;
    if (v !== undefined) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return fail(400, 'invalid_request', 'versionId должно быть целым числом.');
      versionId = v;
    }
  }
  try {
    const db = getDb();
    await setNotDuplicate(db, a.user.id, id, versionId);
    const [game] = await getGamesByIds(db, a.user.id, [id]);
    return ok({ game });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
