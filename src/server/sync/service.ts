// Склейка для API-роутов: зависимости синка из env, запуск звена в after() и самовызов для продолжения (контракт 8.2).
import { after } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db';
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
import { defaultDiscoverDeps } from './discover-step';
import { defaultManualMatchDeps } from './manual-match-step';
import { defaultHltbDeps } from './hltb-step';
import { defaultLlmDeps } from './llm-step';
import { defaultTintDeps } from './tint';
import { resolveOnlineIdFor } from './users';
import { getRunUserId, restartRun, startRun, type RunKind, type StartResult } from './runs';

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
    discover: defaultDiscoverDeps,
    manualMatch: defaultManualMatchDeps,
    connect: () =>
      connectPsn({
        getAccessToken: (force) => getAccessToken(db, cfg, { force }),
        onlineId,
        delayMs: env.requestDelayMs,
        secrets,
      }),
  };
}

export type LaunchResult = StartResult | { kind: 'config_error' } | { kind: 'psn_not_set' } | { kind: 'psn_not_verified' } | { kind: 'user_inactive' };

/**
 * Предупреждения Telegram по итогу запуска пользователя (контракт 22.13): всегда владельцу (один чат).
 * sync_stale считается по пользователю запуска и дедуплицируется как `sync_stale:<id>` (у владельца без суффикса),
 * остальные триггеры глобальные.
 */
async function notifyAbout(db: AnyDb, userId: UserId, opts?: Parameters<typeof notifyAfterSync>[2]): Promise<void> {
  const owner = await getOwnerUserId(db);
  if (!owner) return;
  const isOwner = owner === userId;
  const u = isOwner ? null : await getUserById(db, userId);
  await notifyAfterSync(db, userId, { ...opts, kindSuffix: isOwner ? undefined : `:${userId}`, label: u?.psnOnlineId ?? undefined });
}

/** Без пользователя (нет конфигурации синка): сигнал владельцу по его данным. */
async function notifyOwner(db: AnyDb, opts?: Parameters<typeof notifyAfterSync>[2]): Promise<void> {
  const ownerId = await getOwnerUserId(db);
  if (ownerId) await notifyAbout(db, ownerId, opts);
}

/**
 * Создаёт/возобновляет запуск пользователя и планирует работу в after(). Возвращает сразу.
 * Пользователь: из сессии (userId), из sync_runs при продолжении звена (continueRunId) или владелец (cron без обхода).
 */
export async function launchSync(o: {
  /** Пользователь сессии (ручной синк) или выбранный обходом cron. */
  userId?: UserId;
  kind: RunKind;
  continueRunId?: number;
  hop?: number;
  /** Перезапуск (8.8): отменить идущий запуск пользователя и начать новый с сохранённого места. */
  restart?: boolean;
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
  const user = await getUserById(db, userId);
  if (!user) return { kind: o.continueRunId !== undefined ? 'user_inactive' : 'config_error' };
  // blocked/invited не продолжают и не стартуют (22.13); данные запуска не трогаем
  if (user.status !== 'active') return { kind: 'user_inactive' };
  // Фаза 41 (41.4): профиль заблокированного/удалённого входа не стартует и не продолжается
  if (user.primaryUserId !== null) {
    const login = await getUserById(db, user.primaryUserId);
    if (!login || login.status !== 'active') return { kind: 'user_inactive' };
  }
  const resolved = resolveOnlineIdFor(user, env.targetOnlineId);
  if (resolved.kind !== 'ok') return o.continueRunId !== undefined ? { kind: 'user_inactive' } : { kind: resolved.kind === 'not_set' ? 'psn_not_set' : 'psn_not_verified' };
  const onlineId = resolved.onlineId;
  const started = o.restart && o.continueRunId === undefined ? await restartRun(db, userId, { kind: o.kind, now: new Date() }) : await startRun(db, userId, { kind: o.kind, now: new Date(), continueRunId: o.continueRunId, hop: o.hop });
  if (started.kind !== 'started') return started;

  const run = started.run;
  after(() => work(db, env, run, onlineId));
  return started;
}

/** Первый успешный запуск пользователя завершает онбординг (22.13). Не бросает. */
async function markOnboarded(db: AnyDb, userId: number, now: Date): Promise<void> {
  try {
    await db.update(schema.allowedUsers).set({ onboardedAt: now, updatedAt: now }).where(and(eq(schema.allowedUsers.id, userId), isNull(schema.allowedUsers.onboardedAt)));
  } catch {
    console.error('sync: не удалось отметить онбординг');
  }
}

async function work(db: AnyDb, env: PsnEnv, run: RunRow, onlineId: string): Promise<void> {
  const userId = asUserId(run.userId);
  try {
    const res = await runChunk(buildDeps(db, env, onlineId), run);
    if (res.continueNext && res.hops !== undefined) {
      await continueChain(run.id, res.hops);
      return;
    }
    // отмена (8.8) не ошибка: ни алертов, ни онбординга; обход пользователей ниже продолжается
    if (res.reason === 'cancelled') {
      // ничего
    } else if (res.status === 'success') await markOnboarded(db, run.userId, new Date());
    // 15.4: итог звена не success и не остановка по бюджету -> проверка предупреждений
    else await notifyAbout(db, userId, { errorReason: res.reason });
  } catch (e) {
    // сюда попадает только то, что не поймал runChunk (сборка зависимостей)
    const reason = e instanceof PsnError ? e.reason : 'internal';
    await failRun(db, userId, run.id, reason, safeErr(e, [env.npsso, env.encryptionKey]), new Date()).catch(() => undefined);
    await notifyAbout(db, userId, { errorReason: reason }).catch(() => undefined);
  }
  // обход cron (22.13): запуск пользователя закончен окончательно (успех, сбой, отказ) -> следующий пользователь
  if (run.kind === 'daily') await queueChain(run.userId);
}

export type SelfInvokeDeps = { origin?: string | null; secret?: string | null; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; backoffMs?: readonly number[] };

/** Паузы перед повторами самовызова. Повторы безопасны: принимающая сторона идемпотентна (hop/partial, already_running). */
export const SELF_INVOKE_BACKOFF_MS = [1000, 2000] as const;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/**
 * GET {доверенный origin}{path} с Bearer CRON_SECRET. Origin только из env (getSyncOrigin), не из запроса.
 * Сетевой сбой, 429 и 5xx повторяются (до 3 попыток); тайм-аут не повторяется: запрос мог дойти, а время звена ограничено.
 * Не бросает: запасной путь = догоняющий запуск watchdog, cron или кнопка.
 */
async function selfInvoke(path: string, what: string, deps: SelfInvokeDeps): Promise<boolean> {
  const secret = deps.secret === undefined ? getCronSecret() : deps.secret;
  const origin = deps.origin === undefined ? getSyncOrigin() : deps.origin;
  if (!secret || !origin) return false;
  const delays = deps.backoffMs ?? SELF_INVOKE_BACKOFF_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = new URL(path, origin);
  for (let i = 0; ; i++) {
    let retry = false;
    try {
      const res = await (deps.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      await res.body?.cancel();
      if (res.status < 500 && res.status !== 429) return res.ok;
      retry = true;
      console.error(`sync: ${what}: ответ ${res.status}`);
    } catch (e) {
      console.error(`sync: ${what} не удался`, safeErr(e, [secret]));
      retry = !isTimeout(e);
    }
    if (!retry || i >= delays.length) return false;
    await sleep(delays[i]);
  }
}

/**
 * Самовызов следующего звена: GET {origin}/api/cron/sync?continue=<id>&hop=<N>.
 * Принимающая сторона отвечает 202 сразу, поэтому ждём недолго.
 */
export async function continueChain(runId: number, hop: number, deps: SelfInvokeDeps = {}): Promise<void> {
  await selfInvoke(`/api/cron/sync?continue=${runId}&hop=${hop}`, 'самовызов', deps);
}

/** F2-B: обновление индекса гайдов отдельной функцией (свой бюджет времени), не в звене синка PSN. Не бросает. */
export async function queueGuideRefresh(deps: SelfInvokeDeps = {}): Promise<void> {
  await selfInvoke('/api/cron/guides', 'запуск обновления гайдов', { backoffMs: [], ...deps });
}

/**
 * Самовызов обхода: GET {origin}/api/cron/sync?queue=<id только что закончившего пользователя>[&wait=<N>].
 * Принимающая сторона берёт следующего пользователя с большим id (каждый пользователь не больше раза за обход).
 * wait: номер повторной попытки, если слот был занят ручным синком или HLTB (см. cron/sync).
 */
export async function queueChain(afterUserId: number, deps: SelfInvokeDeps & { wait?: number } = {}): Promise<void> {
  const wait = deps.wait !== undefined ? `&wait=${deps.wait}` : '';
  await selfInvoke(`/api/cron/sync?queue=${afterUserId}${wait}`, 'самовызов обхода', deps);
}
