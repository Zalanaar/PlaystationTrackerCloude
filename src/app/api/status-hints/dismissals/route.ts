import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { parseHintDismissBody } from '@/server/recommend/validation';
import { dismissHint, HintNotFoundError } from '@/server/sync/status-hints-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Не предлагать для этой игры по правилу». Идемпотентно. Контракт 28.6.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseHintDismissBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    await dismissHint(getDb(), a.user.id, p.value.gameId, p.value.rule);
    return ok({ gameId: p.value.gameId, rule: p.value.rule });
  } catch (e) {
    if (e instanceof HintNotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
