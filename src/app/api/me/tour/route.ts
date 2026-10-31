import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fail, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getTourState, markTourDone, parseTourBody } from '@/server/tour/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Прогресс тура пользователя сессии. Контракт 23.3.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const state = await getTourState(getDb(), a.user.id);
    if (!state) return fail(401, 'unauthorized', 'Требуется вход.');
    return NextResponse.json({ ok: true, data: state }, { headers: NO_STORE });
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
  const parsed = parseTourBody(body);
  if (!parsed) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    const state = await markTourDone(getDb(), a.user.id, parsed.version);
    if (!state) return fail(401, 'unauthorized', 'Требуется вход.');
    return NextResponse.json({ ok: true, data: state }, { headers: NO_STORE });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
