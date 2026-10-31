import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { createPlanned, DuplicatePlannedError, listPlanned } from '@/server/roadmap/db';
import { parsePlannedCreate, parsePlannedStatusFilter } from '@/server/roadmap/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Невышедшие игры: список и добавление. Контракт 17.7.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parsePlannedStatusFilter(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ planned: await listPlanned(getDb(), a.user.id, p.value) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parsePlannedCreate(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message, p.details);
  try {
    return ok({ planned: await createPlanned(getDb(), a.user.id, p.value) });
  } catch (e) {
    if (e instanceof DuplicatePlannedError) return fail(409, 'planned_duplicate', 'Эта игра уже добавлена.', e.existingId === null ? undefined : { id: e.existingId });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
