import { getDb } from '@/db';
import { NotFoundError } from '@/server/collection/mutations';
import { parseGameId } from '@/server/collection/validation';
import { deleteDiaryEntry } from '@/server/diary/diary';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; entryId: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = await ctx.params;
  const id = parseGameId(p.id);
  const entryId = parseGameId(p.entryId);
  if (id === null || entryId === null) return fail(400, 'invalid_request', 'Некорректный id.');
  try {
    return ok({ entries: await deleteDiaryEntry(getDb(), a.user.id, id, entryId) });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Заметка не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
