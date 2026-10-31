import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fail, originAllowed } from '@/server/http';
import { defaultHltbDeps } from '@/server/sync/hltb-step';
import { runHltbMass } from '@/server/sync/hltb-run';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Допуск на разброс часов клиента и сервера (16.7).
const SINCE_FUTURE_TOLERANCE_MS = 5000;

// Массовая подгрузка длительности HLTB. Контракт 16.7.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let body: unknown = {};
  const text = await req.text();
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, 'invalid_request', 'Некорректный запрос.');
    }
  }
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : null) as Record<string, unknown> | null;
  if (!b) return fail(400, 'invalid_request', 'Некорректный запрос.');
  const recheck = b.recheckNotFound;
  if (recheck !== undefined && typeof recheck !== 'boolean') return fail(400, 'invalid_request', 'Некорректный запрос.');
  let recheckBefore: Date | undefined;
  if (recheck === true) {
    const since = typeof b.since === 'string' ? new Date(b.since) : null;
    if (!since || Number.isNaN(since.getTime())) return fail(400, 'invalid_request', 'Для перепроверки нужен since (ISO).');
    // будущее since (сверх допуска на разброс часов) отклоняем, а не обрезаем: граница «сейчас» росла бы и зацикливала перепроверку
    if (since.getTime() > Date.now() + SINCE_FUTURE_TOLERANCE_MS) {
      return fail(400, 'invalid_request', 'since не может быть в будущем.', { reason: 'since_in_future' });
    }
    recheckBefore = since;
  }
  try {
    const r = await runHltbMass({ db: getDb(), userId: a.user.id, deps: defaultHltbDeps(), recheckBefore });
    if (r.kind === 'already_running') return fail(409, 'sync_in_progress', 'Синк или подгрузка длительности уже идёт.', { runId: r.runId });
    return NextResponse.json({ ok: true, data: { ...r.result, warnings: r.warnings } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
