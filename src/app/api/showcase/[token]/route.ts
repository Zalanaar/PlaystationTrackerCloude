import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { FEED_TOKEN_RE } from '@/server/roadmap/calendar-feed';
import { showcaseByToken } from '@/server/showcase/showcase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' };

// П14.3: данные публичной витрины. Без сессии (proxy пропускает /api/showcase/), доступ по ключу; закрытая/неверная — 404 (неотличимы).
export async function GET(_req: Request, ctx: Ctx) {
  const token = (await ctx.params).token;
  if (!FEED_TOKEN_RE.test(token)) return fail(404, 'not_found', 'Витрина не найдена.', undefined, PRIVATE);
  try {
    const d = await showcaseByToken(getDb(), token);
    if (!d) return fail(404, 'not_found', 'Витрина не найдена.', undefined, PRIVATE);
    return ok(d, { headers: PRIVATE });
  } catch {
    return fail(503, 'db_unavailable', 'Витрина временно недоступна.', undefined, PRIVATE);
  }
}
