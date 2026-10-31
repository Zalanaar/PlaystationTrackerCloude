import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getCronSecret, getLlmEnv, getPsnEnv, llmLimitWarning } from '@/server/env';
import { fail } from '@/server/http';
import { checkBearer } from '@/server/auth/password';
import { buildCheck, recheckPending } from '@/server/auth/psn-access';
import { getOwnerUserId } from '@/server/auth/users';
import { launchSync, type LaunchResult } from '@/server/sync/service';
import { listSyncUsers } from '@/server/sync/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (data: unknown, status: number) => NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });

function respond(r: LaunchResult) {
  if (r.kind === 'config_error') return fail(500, 'config_error', 'Не заданы настройки PSN.');
  if (r.kind === 'already_running') return json({ started: false, reason: 'already_running', runId: r.runId }, 200);
  if (r.kind === 'not_resumable') return json({ started: false, reason: 'not_resumable' }, 200);
  if (r.kind === 'user_inactive' || r.kind === 'psn_not_set' || r.kind === 'psn_not_verified') return json({ started: false, reason: 'user_inactive' }, 200);
  return json({ started: true, resumed: r.resumed, runId: r.run.id }, 202);
}

// Vercel Cron (раз в сутки), самовызов для продолжения (?continue=<runId>&hop=<N>) и обход пользователей (?queue=<id>). Контракт 8.2, 8.3, 22.13.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) {
    return fail(401, 'unauthorized', 'Не авторизован.');
  }
  const params = new URL(req.url).searchParams;
  const cont = params.get('continue');
  const hopRaw = params.get('hop');
  const queueRaw = params.get('queue');
  const continueRunId = cont === null ? undefined : Number(cont);
  const hop = hopRaw === null ? undefined : Number(hopRaw);
  const queueAfter = queueRaw === null ? undefined : Number(queueRaw);
  if (continueRunId !== undefined && (!Number.isInteger(continueRunId) || continueRunId <= 0)) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  // hop нужен именно для continue (предохранитель на принимающей стороне)
  if (continueRunId !== undefined && (hop === undefined || !Number.isInteger(hop) || hop < 0)) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  if (continueRunId === undefined && hop !== undefined) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (queueAfter !== undefined && (!Number.isInteger(queueAfter) || queueAfter < 0 || continueRunId !== undefined)) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  try {
    // продолжение звена: пользователь берётся из строки sync_runs (не из запроса); blocked не продолжает (launchSync)
    if (continueRunId !== undefined) return respond(await launchSync({ kind: 'daily', continueRunId, hop }));

    const env = getPsnEnv();
    if (!env) return respond(await launchSync({ kind: 'daily' })); // config_error + сигнал владельцу
    const db = getDb();
    if (queueAfter === undefined && !(await getOwnerUserId(db))) return fail(500, 'config_error', 'Не заданы настройки PSN.');

    // старт обхода: сначала повторная проверка unavailable/friend_required (не больше 5, не чаще раза в 6 ч на пользователя)
    if (queueAfter === undefined) await recheckPending(db, buildCheck(db, env)).catch(() => 0);

    const users = await listSyncUsers(db, env.targetOnlineId, { afterId: queueAfter });
    if (queueAfter === undefined) {
      const warn = llmLimitWarning(getLlmEnv(), users.length);
      if (warn) console.warn(`cron: ${warn}`);
    }
    // сбой запуска одного пользователя не останавливает остальных: берём следующего
    for (const u of users) {
      try {
        const r = await launchSync({ userId: u.id, kind: 'daily' });
        if (r.kind === 'started' || r.kind === 'already_running') return respond(r);
      } catch {
        console.error('cron: запуск синка пользователя не удался');
      }
    }
    return json({ started: false, reason: 'queue_empty' }, 200);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
