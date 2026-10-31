// Склейка для API-роутов: зависимости синка из env, запуск звена в after() и самовызов для продолжения (контракт 8.2).
import { after } from 'next/server';
import { getDb } from '@/db';
import type { AnyDb } from '@/db/types';
import { getOwnerUserId, getUserById } from '@/server/auth/users';
import { getAccessToken } from '@/server/psn/auth';
import { connectPsn } from '@/server/psn/client';
import { PsnError, safeErr } from '@/server/psn/errors';
import { getCronSecret, getPsnEnv, getSyncOrigin, type PsnEnv } from '@/server/env';
import { notifyAfterSync } from '@/server/notify/telegram';
import { asUserId, type UserId } from '@/server/auth/user-id';
import { failRun, runChunk, type SyncDeps } from './engine';
import type { RunRow } from './context';
import { defaultHltbDeps } from './hltb-step';
import { defaultLlmDeps } from './llm-step';
import { defaultTintDeps } from './tint';
import { getRunUserId, startRun, type RunKind, type StartResult } from './runs';

export function buildDeps(db: AnyDb, env: PsnEnv, onlineId: string = env.targetOnlineId): SyncDeps {
  const cfg = { npsso: env.npsso, encryptionKey: env.encryptionKey };
  const secrets = [env.npsso, env.encryptionKey];
  return {
    db,
    now: () => new Date(),
    budgetMs: env.timeBudgetMs,
    secrets,
    tint: defaultTintDeps,
    hltb: defaultHltbDeps(),
    llm: defaultLlmDeps,
    connect: () =>
      connectPsn({
        getAccessToken: (force) => getAccessToken(db, cfg, { force }),
        onlineId,
        delayMs: env.requestDelayMs,
        secrets,
      }),
  };
}

export type LaunchResult = StartResult | { kind: 'config_error' };

/**
 * Ник PSN, который читает синк пользователя: его psn_online_id. Владельцу без своего ника подходит PSN_TARGET_ONLINE_ID (старый режим),
 * остальным нет: чужой ник из env в их коллекцию попасть не должен. null = синк недоступен.
 */
async function resolveOnlineId(db: AnyDb, userId: UserId, env: PsnEnv): Promise<string | null> {
  const u = await getUserById(db, userId);
  if (!u) return null;
  const own = u.psnOnlineId?.trim();
  if (own) return own;
  return u.role === 'owner' ? env.targetOnlineId : null;
}

/** Уведомления Telegram остаются владельцу (20.3); обход пользователей придёт в 20.4. */
async function notifyOwner(db: AnyDb, opts?: Parameters<typeof notifyAfterSync>[2]): Promise<void> {
  const ownerId = await getOwnerUserId(db);
  if (ownerId) await notifyAfterSync(db, ownerId, opts);
}

/** Создаёт/возобновляет запуск пользователя и планирует работу в after(). Возвращает сразу. */
export async function launchSync(o: {
  /** Ручной синк: пользователь сессии. Не задан только у cron (20.3): тогда владелец или, при продолжении, владелец запуска из sync_runs. */
  userId?: UserId;
  kind: RunKind;
  continueRunId?: number;
  hop?: number;
}): Promise<LaunchResult> {
  const env = getPsnEnv();
  if (!env) {
    // 15.4: синк не стартует вообще: сработает триггер sync_stale, если так уже давно
    try {
      const db = getDb();
      after(() => notifyOwner(db));
    } catch {
      // нет DATABASE_URL: уведомлять нечем
    }
    return { kind: 'config_error' };
  }
  const db = getDb();
  const userId = o.userId ?? (o.continueRunId !== undefined ? await getRunUserId(db, o.continueRunId) : await getOwnerUserId(db));
  if (!userId) return o.continueRunId !== undefined ? { kind: 'not_resumable' } : { kind: 'config_error' };
  const onlineId = await resolveOnlineId(db, userId, env);
  if (!onlineId) return { kind: 'config_error' };
  const started = await startRun(db, userId, { kind: o.kind, now: new Date(), continueRunId: o.continueRunId, hop: o.hop });
  if (started.kind !== 'started') return started;

  const run = started.run;
  after(() => work(db, env, run, onlineId));
  return started;
}

async function work(db: AnyDb, env: PsnEnv, run: RunRow, onlineId: string): Promise<void> {
  try {
    const res = await runChunk(buildDeps(db, env, onlineId), run);
    if (res.continueNext && res.hops !== undefined) await continueChain(run.id, res.hops);
    // 15.4: итог звена не success и не остановка по бюджету -> проверка предупреждений
    else if (res.status !== 'success') await notifyOwner(db, { errorReason: res.reason });
  } catch (e) {
    // сюда попадает только то, что не поймал runChunk (сборка зависимостей)
    const reason = e instanceof PsnError ? e.reason : 'internal';
    await failRun(db, asUserId(run.userId), run.id, reason, safeErr(e, [env.npsso, env.encryptionKey]), new Date()).catch(() => undefined);
    await notifyOwner(db, { errorReason: reason });
  }
}

/**
 * Самовызов следующего звена: GET {доверенный origin}/api/cron/sync?continue=<id>&hop=<N> с Bearer CRON_SECRET.
 * Origin только из env (getSyncOrigin), не из запроса. Принимающая сторона отвечает 202 сразу, поэтому ждём недолго.
 * Ошибка не критична: запасной путь = cron/кнопка.
 */
export async function continueChain(
  runId: number,
  hop: number,
  deps: { origin?: string | null; secret?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const secret = deps.secret === undefined ? getCronSecret() : deps.secret;
  const origin = deps.origin === undefined ? getSyncOrigin() : deps.origin;
  if (!secret || !origin) return;
  try {
    const url = new URL(`/api/cron/sync?continue=${runId}&hop=${hop}`, origin);
    const res = await (deps.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    await res.body?.cancel();
  } catch (e) {
    console.error('sync: самовызов не удался', safeErr(e, [secret]));
  }
}
