// Склейка для API-роутов: зависимости синка из env, запуск звена в after() и самовызов для продолжения (контракт 8.2).
import { after } from 'next/server';
import { getDb } from '@/db';
import type { AnyDb } from '@/db/types';
import { getAccessToken } from '@/server/psn/auth';
import { connectPsn } from '@/server/psn/client';
import { PsnError, safeErr } from '@/server/psn/errors';
import { getCronSecret, getPsnEnv, getSyncOrigin, type PsnEnv } from '@/server/env';
import { failRun, runChunk, type SyncDeps } from './engine';
import type { RunRow } from './context';
import { startRun, type RunKind, type StartResult } from './runs';

export function buildDeps(db: AnyDb, env: PsnEnv): SyncDeps {
  const cfg = { npsso: env.npsso, encryptionKey: env.encryptionKey };
  const secrets = [env.npsso, env.encryptionKey];
  return {
    db,
    now: () => new Date(),
    budgetMs: env.timeBudgetMs,
    secrets,
    connect: () =>
      connectPsn({
        getAccessToken: (force) => getAccessToken(db, cfg, { force }),
        onlineId: env.targetOnlineId,
        delayMs: env.requestDelayMs,
        secrets,
      }),
  };
}

export type LaunchResult = StartResult | { kind: 'config_error' };

/** Создаёт/возобновляет запуск и планирует работу в after(). Возвращает сразу. */
export async function launchSync(o: { kind: RunKind; continueRunId?: number; hop?: number }): Promise<LaunchResult> {
  const env = getPsnEnv();
  if (!env) return { kind: 'config_error' };
  const db = getDb();
  const started = await startRun(db, { kind: o.kind, now: new Date(), continueRunId: o.continueRunId, hop: o.hop });
  if (started.kind !== 'started') return started;

  const run = started.run;
  after(() => work(db, env, run));
  return started;
}

async function work(db: AnyDb, env: PsnEnv, run: RunRow): Promise<void> {
  try {
    const res = await runChunk(buildDeps(db, env), run);
    if (res.continueNext && res.hops !== undefined) await continueChain(run.id, res.hops);
  } catch (e) {
    // сюда попадает только то, что не поймал runChunk (сборка зависимостей)
    const reason = e instanceof PsnError ? e.reason : 'internal';
    await failRun(db, run.id, reason, safeErr(e, [env.npsso, env.encryptionKey]), new Date()).catch(() => undefined);
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
