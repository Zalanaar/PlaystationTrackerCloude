import { after, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getCronSecret, getLlmEnv, getPsnEnv, llmLimitWarning } from '@/server/env';
import { fail } from '@/server/http';
import { checkBearer } from '@/server/auth/password';
import { buildCheck, recheckPending } from '@/server/auth/psn-access';
import { getOwnerUserId } from '@/server/auth/users';
import { launchSync, queueChain, type LaunchResult } from '@/server/sync/service';
import { listSyncUsers } from '@/server/sync/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (data: unknown, status: number) => NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Слот running один на всю систему. Если его держит не обход (ручной синк или HLTB), обход не обрывается:
 * пауза и самовызов той же позиции очереди (?queue=<id-1>&wait=<N>), не больше QUEUE_MAX_WAITS раз (~20 мин).
 * Дальше страхует догоняющий запуск watchdog.
 */
export const QUEUE_MAX_WAITS = 40;
const QUEUE_WAIT_MS_DEFAULT = 30_000;
function queueWaitMs(): number {
  const v = Number(process.env.SYNC_QUEUE_WAIT_MS);
  return Number.isFinite(v) && v >= 0 && v <= 45_000 ? v : QUEUE_WAIT_MS_DEFAULT;
}

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
  const waitRaw = params.get('wait');
  const continueRunId = cont === null ? undefined : Number(cont);
  const hop = hopRaw === null ? undefined : Number(hopRaw);
  const queueAfter = queueRaw === null ? undefined : Number(queueRaw);
  const wait = waitRaw === null ? undefined : Number(waitRaw);
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
  // wait только вместе с queue
  if (wait !== undefined && (queueAfter === undefined || !Number.isInteger(wait) || wait < 1 || wait > QUEUE_MAX_WAITS)) {
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
        if (r.kind === 'started') return respond(r);
        if (r.kind === 'already_running') {
          // слот держит сам обход (daily): он продолжит очередь сам
          const [busy] = r.runId === null ? [] : await db.select({ kind: schema.syncRuns.kind }).from(schema.syncRuns).where(eq(schema.syncRuns.id, r.runId)).limit(1);
          if (!busy || busy.kind === 'daily') return respond(r);
          const next = (wait ?? 0) + 1;
          if (next > QUEUE_MAX_WAITS) {
            console.error('cron: слот синка занят слишком долго, обход отложен до догоняющего запуска');
            return json({ started: false, reason: 'busy_gave_up' }, 200);
          }
          const ms = queueWaitMs();
          after(async () => {
            await new Promise<void>((res) => setTimeout(res, ms));
            await queueChain(u.id - 1, { wait: next });
          });
          return json({ started: false, reason: 'waiting_slot', wait: next }, 202);
        }
      } catch {
        console.error('cron: запуск синка пользователя не удался');
      }
    }
    return json({ started: false, reason: 'queue_empty' }, 200);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
