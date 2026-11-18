import { getDb } from '@/db';
import { FEED_TOKEN_RE, feedByToken } from '@/server/roadmap/calendar-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' };

// Живая подписка на календарь релизов. Без сессии: доступ по личному ключу в адресе (в БД только его SHA-256).
// Неверный/отозванный ключ — 404 без подробностей. Только названия и даты релизов.
export async function GET(_req: Request, ctx: Ctx) {
  const raw = (await ctx.params).token;
  const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw;
  const notFound = () => new Response('Not found', { status: 404, headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!FEED_TOKEN_RE.test(token)) return notFound(); // кривой ключ — без похода в БД
  try {
    const body = await feedByToken(getDb(), token, new Date());
    if (body === null) return notFound();
    return new Response(body, { status: 200, headers: { ...PRIVATE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="releases.ics"' } });
  } catch {
    return new Response('Unavailable', { status: 503, headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '600' } });
  }
}
