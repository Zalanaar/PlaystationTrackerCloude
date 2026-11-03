import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fail, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getWhatsNewSeen, markWhatsNewSeen, parseWhatsNewBody } from '@/server/whatsnew/seen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// P2-16: «Что нового» прочитано до id `seen` (null = ещё не отмечал). Контракт 23.5.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const seen = await getWhatsNewSeen(getDb(), a.user.id);
    if (seen === undefined) return fail(401, 'unauthorized', 'Требуется вход.');
    return NextResponse.json({ ok: true, data: { seen } }, { headers: NO_STORE });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const parsed = parseWhatsNewBody(body);
  if (!parsed) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    const seen = await markWhatsNewSeen(getDb(), a.user.id, parsed.seen);
    if (seen === undefined) return fail(401, 'unauthorized', 'Требуется вход.');
    return NextResponse.json({ ok: true, data: { seen } }, { headers: NO_STORE });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
