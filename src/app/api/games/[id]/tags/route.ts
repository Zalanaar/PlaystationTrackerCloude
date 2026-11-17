import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { parseGameId } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { GAME_TAGS_MAX, gameTagIds, setGameTags, TagError } from '@/server/tags/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const idList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length <= GAME_TAGS_MAX && v.every((x) => Number.isInteger(x) && x > 0 && x <= 2_147_483_647) ? (v as number[]) : null;

// П13.2: GET — id тегов игры; PUT { tagIds } — заменить набор (до 20).
export async function GET(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  try {
    return ok({ tagIds: await gameTagIds(getDb(), a.user.id, id) });
  } catch (e) {
    if (e instanceof TagError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const tagIds = idList((read.body as { tagIds?: unknown } | null)?.tagIds);
  if (tagIds === null) return fail(400, 'invalid_request', `tagIds: до ${GAME_TAGS_MAX} id тегов.`);
  try {
    return ok({ tagIds: await setGameTags(getDb(), a.user.id, id, tagIds) });
  } catch (e) {
    if (e instanceof TagError && e.code === 'game_not_found') return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof TagError) return fail(404, 'not_found', 'Тег не найден.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
