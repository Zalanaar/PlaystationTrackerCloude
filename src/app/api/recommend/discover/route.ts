import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getDiscover } from '@/server/recommend/discover';
import { parseRefresh } from '@/server/recommend/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Без кэша: до 15 запросов к RAWG (бюджет 20 с) плюс Groq (до 15 с). Контракт 19.6.
export const maxDuration = 60;

// «Новое от ИИ». Сбои Groq и RAWG не ошибка HTTP, а meta. Сессию проверяет src/proxy.ts.
export async function GET(req: Request) {
  const r = parseRefresh(new URL(req.url).searchParams.get('refresh'));
  if (!r.ok) return fail(400, 'invalid_request', r.message);
  try {
    return ok(await getDiscover(getDb(), { refresh: r.value }));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
