import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { saveOrder, UnknownGamesError } from '@/server/roadmap/db';
import { parseOrderBody } from '@/server/roadmap/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ручной порядок очереди бэклога (drag&drop). Контракт 17.8.
export async function PUT(req: Request) {
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseOrderBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ order: await saveOrder(getDb(), p.value) });
  } catch (e) {
    if (e instanceof UnknownGamesError) return fail(400, 'invalid_request', 'В порядке есть неизвестные игры.', { unknown: e.ids });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
