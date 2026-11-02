// Авторизация PSN: NPSSO -> токены, refresh, хранение в psn_auth (AES-GCM). Контракт: 1.8.
// Токены и NPSSO не логируются и не попадают в сообщения ошибок.
import { eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { decryptToken, encryptToken } from './crypto';
import { PsnError, classifyPsnError } from './errors';
import { recordTokenEvent } from './token-events';

const { psnAuth } = schema;

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number; refreshTokenExpiresIn: number };

/** Обмены токенов. null = PSN отвергло вход (не сеть, не лимит). Временные сбои бросают PsnError (rate_limited / psn_unavailable). */
export interface AuthApi {
  exchangeNpsso(npsso: string): Promise<TokenPair | null>;
  exchangeRefresh(refreshToken: string): Promise<TokenPair | null>;
}

function toPair(t: unknown): TokenPair | null {
  const o = (t ?? {}) as Record<string, unknown>;
  if (typeof o.access_token !== 'string' || typeof o.refresh_token !== 'string' || !o.access_token || !o.refresh_token) return null;
  return {
    accessToken: o.access_token,
    refreshToken: o.refresh_token,
    expiresIn: typeof o.expires_in === 'number' ? o.expires_in : 3600,
    refreshTokenExpiresIn: typeof o.refresh_token_expires_in === 'number' ? o.refresh_token_expires_in : 0,
  };
}

// psn-api на обмене токенов теряет HTTP-статус и тело ошибки (возвращает объект с undefined токенами),
// поэтому обмен сделан здесь. Публичные параметры мобильного клиента PSN те же, что в psn-api.
const OAUTH = 'https://ca.account.sony.com/api/authz/v3/oauth';
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const BASIC = 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';
const HTTP_TIMEOUT_MS = 15_000;

async function doFetch(url: string, init: RequestInit, secrets: string[]): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), cache: 'no-store' });
  } catch (e) {
    throw classifyPsnError(e, secrets);
  }
}

/** 429 -> rate_limited, 5xx -> psn_unavailable, иначе null. */
function transientByStatus(status: number, what: string): PsnError | null {
  if (status === 429) return new PsnError('rate_limited', `PSN: ${what}: 429 Too Many Requests.`);
  if (status >= 500) return new PsnError('psn_unavailable', `PSN: ${what}: ошибка сервера ${status}.`);
  return null;
}

/** Отказ (null) только при 400/401/403 без признака лимита. Нет токенов в остальных случаях = временный сбой. */
async function tokenRequest(params: Record<string, string>, secrets: string[]): Promise<TokenPair | null> {
  const res = await doFetch(
    `${OAUTH}/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: BASIC },
      body: new URLSearchParams({ ...params, token_format: 'jwt' }).toString(),
    },
    secrets,
  );
  const transient = transientByStatus(res.status, 'обмен токенов');
  if (transient) {
    void res.body?.cancel().catch(() => undefined);
    throw transient;
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const pair = res.ok ? toPair(body) : null;
  if (pair) return pair;
  const errCode = String((body as { error?: unknown } | null)?.error ?? '').toLowerCase();
  if (/rate|throttl|too_many/.test(errCode)) throw new PsnError('rate_limited', 'PSN: обмен токенов: лимит запросов.');
  if (!res.ok && [400, 401, 403].includes(res.status)) return null; // invalid_grant, invalid_request и т.п.
  throw new PsnError('psn_unavailable', `PSN: обмен токенов: ответ ${res.status} без токенов.`);
}

async function authorizeCode(npsso: string): Promise<string | null> {
  const qs = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
  }).toString();
  const res = await doFetch(`${OAUTH}/authorize?${qs}`, { headers: { Cookie: `npsso=${npsso}` }, redirect: 'manual' }, [npsso]);
  void res.body?.cancel().catch(() => undefined);
  const transient = transientByStatus(res.status, 'авторизация NPSSO');
  if (transient) throw transient;
  const loc = res.headers.get('location');
  if (loc?.includes('?code=')) {
    const code = new URLSearchParams(loc.split('redirect/')[1] ?? '').get('code');
    if (code) return code;
  }
  // 3xx без code или 401/403: NPSSO не принят
  if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) return null;
  throw new PsnError('psn_unavailable', `PSN: авторизация NPSSO: неожиданный ответ ${res.status}.`);
}

export const defaultAuthApi: AuthApi = {
  async exchangeNpsso(npsso) {
    const code = await authorizeCode(npsso);
    if (!code) return null;
    return tokenRequest({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }, [npsso, code]);
  },
  exchangeRefresh(refreshToken) {
    return tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token', scope: SCOPE }, [refreshToken]);
  },
};

export type AuthConfig = { npsso: string | null; encryptionKey: string };
export type AuthOptions = {
  now?: () => Date;
  api?: AuthApi;
  /** игнорировать закэшированный access token */
  force?: boolean;
  /** паузы перед повторами при 429/5xx, мс */
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
};

const ACCESS_MARGIN_MS = 120_000;
const DEFAULT_BACKOFF_MS = [500, 1500] as const;

/** Повторы только для временных сбоев (rate_limited, psn_unavailable). Отказ (null) и прочие ошибки не повторяются. */
async function withRetry<T>(fn: () => Promise<T>, opts: AuthOptions): Promise<T> {
  const delays = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof PsnError) || !e.retryable || i >= delays.length) throw e;
      await sleep(delays[i]);
    }
  }
}

/** Шифрует и сохраняет пару токенов одной записью. */
export async function saveTokens(db: AnyDb, cfg: Pick<AuthConfig, 'encryptionKey'>, pair: TokenPair, source: 'npsso' | 'refresh', now: Date): Promise<void> {
  const values = {
    id: 1,
    refreshTokenEnc: encryptToken(pair.refreshToken, cfg.encryptionKey),
    refreshExpiresAt: pair.refreshTokenExpiresIn > 0 ? new Date(now.getTime() + pair.refreshTokenExpiresIn * 1000) : null,
    accessTokenEnc: encryptToken(pair.accessToken, cfg.encryptionKey),
    accessExpiresAt: new Date(now.getTime() + pair.expiresIn * 1000),
    source,
    updatedAt: now,
  };
  // одна атомарная запись пары
  await db.insert(psnAuth).values(values).onConflictDoUpdate({ target: psnAuth.id, set: values });
}

/** Ключ advisory lock для обмена токенов PSN (одна запись psn_auth на всю систему). */
export const PSN_AUTH_LOCK_KEY = 7204101;

/** Блокировка обмена токенов: параллельные refresh/NPSSO идут строго по одному (refresh-токен ротируется). */
export async function lockPsnAuth(tx: AnyDb): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PSN_AUTH_LOCK_KEY})`);
}

type AuthRow = typeof psnAuth.$inferSelect;

function liveAccess(row: AuthRow | undefined, cfg: AuthConfig, now: Date): string | null {
  try {
    if (row?.accessTokenEnc && row.accessExpiresAt && row.accessExpiresAt.getTime() > now.getTime() + ACCESS_MARGIN_MS) {
      return decryptToken(row.accessTokenEnc, cfg.encryptionKey);
    }
  } catch {
    // ключ сменился или запись повреждена: как будто токенов нет
  }
  return null;
}

type Exchange =
  | { kind: 'token'; token: string; event?: { kind: 'refreshed' | 'from_env'; expiresInSec: number } }
  | { kind: 'fail'; hadRefresh: boolean; hadRow: boolean };

/**
 * Порядок (контракт 1.8): живой access из БД -> refresh -> NPSSO -> ошибка.
 * auth_expired, если refresh был, но ни он, ни NPSSO не подошли; npsso_invalid, если refresh не было.
 * Временный сбой PSN (429/5xx/нет токенов без признака отказа) повторяется и бросается как rate_limited / psn_unavailable.
 * Обмен идёт в транзакции под advisory lock: второй параллельный вызов ждёт и после блокировки перечитывает запись.
 * Если её уже обновили, берёт свежий access вместо второго refresh (иначе ротированный refresh мог потеряться).
 */
export async function getAccessToken(db: AnyDb, cfg: AuthConfig, opts: AuthOptions = {}): Promise<string> {
  const now = (opts.now ?? (() => new Date()))();
  const api = opts.api ?? defaultAuthApi;
  const [seen] = await db.select().from(psnAuth).where(eq(psnAuth.id, 1)).limit(1);
  if (!opts.force) {
    const live = liveAccess(seen, cfg, now);
    if (live) return live;
  }

  const res = await db.transaction(async (tx): Promise<Exchange> => {
    await lockPsnAuth(tx);
    const [row] = await tx.select().from(psnAuth).where(eq(psnAuth.id, 1)).limit(1);
    // пока ждали блокировку, запись обновил другой вызов: его access свежий, повторный обмен не нужен (и при force)
    const changed = !!row && (!seen || row.updatedAt.getTime() !== seen.updatedAt.getTime() || row.refreshTokenEnc !== seen.refreshTokenEnc);
    if (changed || !opts.force) {
      const live = liveAccess(row, cfg, now);
      if (live) return { kind: 'token', token: live };
    }

    let refresh: string | null = null;
    if (row) {
      try {
        if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() > now.getTime()) {
          refresh = decryptToken(row.refreshTokenEnc, cfg.encryptionKey);
        }
      } catch {
        refresh = null;
      }
    }
    const hadRefresh = refresh !== null;

    if (refresh) {
      const token = refresh;
      const pair = await withRetry(() => api.exchangeRefresh(token), opts);
      if (pair) {
        await saveTokens(tx, cfg, pair, 'refresh', now);
        return { kind: 'token', token: pair.accessToken, event: { kind: 'refreshed', expiresInSec: pair.refreshTokenExpiresIn } };
      }
    }
    const npsso = cfg.npsso;
    if (npsso) {
      const pair = await withRetry(() => api.exchangeNpsso(npsso), opts);
      if (pair) {
        await saveTokens(tx, cfg, pair, 'npsso', now);
        return { kind: 'token', token: pair.accessToken, event: { kind: 'from_env', expiresInSec: pair.refreshTokenExpiresIn } };
      }
    }
    return { kind: 'fail', hadRefresh, hadRow: !!row };
  });

  // журнал пишется после фиксации транзакции: его сбой не должен откатывать сохранённые токены
  if (res.kind === 'token') {
    if (res.event) await recordTokenEvent(db, res.event.kind, { now, details: { refreshTokenExpiresInSec: res.event.expiresInSec } });
    return res.token;
  }
  const { hadRefresh, hadRow } = res;
  const reason = hadRefresh || hadRow ? 'auth_expired' : 'npsso_invalid';
  // npsso_invalid без сохранённых токенов и без NPSSO в env: протухания не было, просто токена нет
  if (hadRefresh || hadRow || cfg.npsso) await recordTokenEvent(db, 'expired', { now, details: { reason, hadRefresh } });
  if (hadRefresh || hadRow) {
    throw new PsnError('auth_expired', 'Refresh token PSN не подошёл и NPSSO отвергнут или не задан: нужен новый NPSSO.');
  }
  throw new PsnError('npsso_invalid', cfg.npsso ? 'NPSSO отвергнут PSN: нужен новый NPSSO.' : 'PSN_NPSSO не задан и сохранённых токенов нет.');
}
