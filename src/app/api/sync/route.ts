import { NextResponse } from 'next/server';
import { fail, originAllowed } from '@/server/http';
import { launchSync } from '@/server/sync/service';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// «Синк сейчас». Контракт 8.3.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  try {
    const r = await launchSync({ userId: a.user.id, kind: 'manual' });
    if (r.kind === 'config_error') return fail(500, 'config_error', 'Не заданы настройки PSN.');
    if (r.kind === 'already_running') return fail(409, 'sync_in_progress', 'Синк уже идёт.', { runId: r.runId });
    if (r.kind === 'not_resumable') return fail(500, 'internal_error', 'Не удалось запустить синк.');
    const { run, resumed } = r;
    return NextResponse.json(
      { ok: true, data: { started: true, resumed, run: { id: run.id, kind: run.kind, status: run.status, phase: run.phase } } },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
