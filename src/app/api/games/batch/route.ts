import { getDb } from '@/db';
import { parseBatch, runGamesBatch } from '@/server/collection/batch';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Блоки хроники одним запросом (Фаза 48, контракт 48.1): каждый `b` = query-строка 9.2, ответ по порядку.
// Одна проверка сессии и один круг сети вместо шести; упавший блок не роняет остальные.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const parsed = parseBatch(new URL(req.url).searchParams);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message);
  const data = await runGamesBatch(getDb(), a.user.id, parsed.value, new Date());
  if (!data) return fail(503, 'db_unavailable', 'База данных недоступна.');
  return okRevalidated(req, data);
}
