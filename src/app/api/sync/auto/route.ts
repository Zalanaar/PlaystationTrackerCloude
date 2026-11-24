import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fail, originAllowed } from '@/server/http';
import { launchSync } from '@/server/sync/service';
import { autoSyncDecision, loadAutoSyncInputs } from '@/server/sync/auto';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'Cache-Control': 'no-store' };

// Идея 1 (аудит UX): автосинк при открытии. Сервер сам решает, пора ли (данным больше 6 ч, не чаще раза в 6 ч, без
// параллельного запуска); ошибки запуска не показываются — это фоновое действие, «Синк с PSN» остаётся как был.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  try {
    const d = autoSyncDecision(await loadAutoSyncInputs(getDb(), a.user.id), new Date());
    if (!d.go) return NextResponse.json({ ok: true, data: { started: false, reason: d.reason } }, { headers: noStore });
    const r = await launchSync({ userId: a.user.id, kind: 'manual' });
    if (r.kind !== 'started') return NextResponse.json({ ok: true, data: { started: false, reason: r.kind } }, { headers: noStore });
    return NextResponse.json({ ok: true, data: { started: true, run: { id: r.run.id, status: r.run.status } } }, { status: 202, headers: noStore });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
