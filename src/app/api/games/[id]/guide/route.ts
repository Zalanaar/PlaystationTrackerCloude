import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { NotFoundError } from '@/server/collection/mutations';
import { parseGameId } from '@/server/collection/validation';
import { parseGuideBody, setGameGuide } from '@/server/guides/game-guide';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// F2-B: своя ссылка на гайд {"override": "https://…"|null} и/или «Не тот гайд» {"dismissed": true|false}. Контракт F2-B.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseGuideBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const r = await setGameGuide(getDb(), a.user.id, id, p.value);
    return ok(r);
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
