import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { parseGameId } from '@/server/collection/validation';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { deleteTag, normalizeTagName, renameTag, TagError } from '@/server/tags/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// П13.2: PATCH { name } — переименовать; DELETE — удалить тег (с игр снимается, игры остаются).
export async function PATCH(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id тега.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const name = normalizeTagName((read.body as { name?: unknown } | null)?.name);
  if (name === null) return fail(400, 'invalid_request', 'Название тега: от 1 до 32 символов.');
  try {
    await renameTag(getDb(), a.user.id, id, name);
    return ok({ id, name });
  } catch (e) {
    if (e instanceof TagError && e.code === 'not_found') return fail(404, 'not_found', 'Тег не найден.');
    if (e instanceof TagError && e.code === 'tag_exists') return fail(409, 'tag_exists', 'Такой тег уже есть.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id тега.');
  try {
    await deleteTag(getDb(), a.user.id, id);
    return ok({ id });
  } catch (e) {
    if (e instanceof TagError && e.code === 'not_found') return fail(404, 'not_found', 'Тег не найден.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
