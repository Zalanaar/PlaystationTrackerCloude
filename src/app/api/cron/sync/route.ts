import { NextResponse } from 'next/server';
import { getCronSecret } from '@/server/env';
import { fail } from '@/server/http';
import { checkBearer } from '@/server/auth/password';
import { launchSync } from '@/server/sync/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (data: unknown, status: number) => NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });

// Vercel Cron (раз в сутки) и самовызов для продолжения (?continue=<runId>). Контракт 8.2, 8.3.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) {
    return fail(401, 'unauthorized', 'Не авторизован.');
  }
  const params = new URL(req.url).searchParams;
  const cont = params.get('continue');
  const hopRaw = params.get('hop');
  const continueRunId = cont === null ? undefined : Number(cont);
  const hop = hopRaw === null ? undefined : Number(hopRaw);
  if (continueRunId !== undefined && (!Number.isInteger(continueRunId) || continueRunId <= 0)) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  // hop нужен именно для continue (предохранитель на принимающей стороне)
  if (continueRunId !== undefined && (hop === undefined || !Number.isInteger(hop) || hop < 0)) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  if (continueRunId === undefined && hop !== undefined) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    // 20.3: ежедневный синк идёт для владельца; продолжение звена берёт пользователя из строки sync_runs (не из запроса). Обход всех: 20.4.
    const r = await launchSync({ kind: 'daily', continueRunId, hop });
    if (r.kind === 'config_error') return fail(500, 'config_error', 'Не заданы настройки PSN.');
    if (r.kind === 'already_running') return json({ started: false, reason: 'already_running', runId: r.runId }, 200);
    if (r.kind === 'not_resumable') return json({ started: false, reason: 'not_resumable' }, 200);
    return json({ started: true, resumed: r.resumed, runId: r.run.id }, 202);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
