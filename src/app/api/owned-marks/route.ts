import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { GameNotFoundError, listOwnedMarks, upsertOwnedMark } from '@/server/owned/marks';
import { parseOwnedMarkBody } from '@/server/owned/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Все отметки «Уже есть / проходил» пользователя. Контракт Фазы 40, 40.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok({ marks: await listOwnedMarks(getDb(), a.user.id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// Создать или обновить отметку (идемпотентно). covered: игра должна быть у этого пользователя.
export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseOwnedMarkBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ mark: await upsertOwnedMark(getDb(), a.user.id, p.value) });
  } catch (e) {
    if (e instanceof GameNotFoundError) return fail(404, 'not_found', 'Игра не найдена в библиотеке.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
