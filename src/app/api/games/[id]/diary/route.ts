import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { NotFoundError } from '@/server/collection/mutations';
import { parseGameId } from '@/server/collection/validation';
import { addDiaryEntry, DiaryLimitError, listDiary, parseDiaryBody } from '@/server/diary/diary';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  try {
    return ok({ entries: await listDiary(getDb(), a.user.id, id) });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseDiaryBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ entries: await addDiaryEntry(getDb(), a.user.id, id, p.text) });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof DiaryLimitError) return fail(400, 'invalid_request', 'Можно сохранить до 50 заметок у одной игры.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
