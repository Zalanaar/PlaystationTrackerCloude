import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { createTag, listTags, normalizeTagName, TAG_LIMIT, TagError } from '@/server/tags/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П13.2 (контракт «П13. Теги»): GET — теги профиля со счётчиками игр; POST { name } — новый тег.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await listTags(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const name = normalizeTagName((read.body as { name?: unknown } | null)?.name);
  if (name === null) return fail(400, 'invalid_request', 'Название тега: от 1 до 32 символов.');
  try {
    return ok({ tag: await createTag(getDb(), a.user.id, name) });
  } catch (e) {
    if (e instanceof TagError && e.code === 'tag_exists') return fail(409, 'tag_exists', 'Такой тег уже есть.');
    if (e instanceof TagError && e.code === 'tag_limit') return fail(409, 'tag_limit', `Не больше ${TAG_LIMIT} тегов.`);
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
