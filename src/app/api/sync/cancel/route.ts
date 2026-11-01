import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { asUserId } from '@/server/auth/user-id';
import { fail, originAllowed } from '@/server/http';
import { CANCEL_MESSAGE_OWNER, CANCEL_MESSAGE_SELF, cancelRun } from '@/server/sync/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Остановить синк». Контракт 8.8. Владелец может указать userId другого пользователя; member только себя.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim() !== '') body = JSON.parse(text);
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  const raw = (body as Record<string, unknown>).userId;
  if (raw !== undefined && (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0)) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const target = raw === undefined ? a.user.id : asUserId(raw);
  // роль из БД (requireUser); чужой userId без роли owner = 403 независимо от того, есть ли у него запуск
  if (target !== a.user.id && a.user.role !== 'owner') return fail(403, 'forbidden', 'Недостаточно прав.');
  try {
    const cancelled = await cancelRun(getDb(), target, new Date(), target === a.user.id ? CANCEL_MESSAGE_SELF : CANCEL_MESSAGE_OWNER);
    return NextResponse.json({ ok: true, data: { cancelled: !!cancelled, runId: cancelled?.id ?? null } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
