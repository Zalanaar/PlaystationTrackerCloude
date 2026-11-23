import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { NotFoundError } from '@/server/collection/mutations';
import { HuntConflictError, HuntLimitError, parseHuntTrophyBody, setHuntTrophy } from '@/server/hunts/hunts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function parseBody(req: Request): Promise<unknown> {
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try { return await req.json(); } catch { return null; }
}

// PUT { gameId, setId, trophyId, on } — закрепить или снять трофей (лимит 5).
export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const parsed = parseHuntTrophyBody(await parseBody(req));
  if (!parsed.ok) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok(await setHuntTrophy(getDb(), a.user.id, parsed.gameId, parsed.setId, parsed.trophyId, parsed.on));
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Трофей не найден.');
    if (e instanceof HuntLimitError) return fail(400, 'invalid_request', 'Можно закрепить до 5 трофеев. Сними один, чтобы добавить новый.');
    if (e instanceof HuntConflictError) return fail(400, 'invalid_request', e.message);
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
