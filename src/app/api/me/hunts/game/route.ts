import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { NotFoundError } from '@/server/collection/mutations';
import { HuntConflictError, parseHuntGameBody, setHuntGame } from '@/server/hunts/hunts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function parseBody(req: Request): Promise<unknown> {
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try { return await req.json(); } catch { return null; }
}

// PUT { gameId: number | null } — закрепить игру за платиной или снять.
export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const parsed = parseHuntGameBody(await parseBody(req));
  if (!parsed.ok) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok(await setHuntGame(getDb(), a.user.id, parsed.gameId));
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof HuntConflictError) return fail(400, 'invalid_request', e.message);
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
