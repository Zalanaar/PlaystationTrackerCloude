// Конверт ответов API (контракт 4.1) и общие проверки запросов.
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'user_exists'
  | 'user_limit'
  | 'owner_protected'
  | 'not_blocked'
  | 'multiuser_not_ready'
  | 'confirm_mismatch'
  | 'profile_limit'
  | 'primary_protected'
  | 'invalid_credentials'
  | 'not_found'
  | 'rate_limited'
  | 'sync_in_progress'
  | 'status_conflict'
  | 'month_exclusion_conflict'
  | 'planned_duplicate'
  | 'duplicate_game'
  | 'manual_limit'
  | 'manual_status_locked'
  | 'settings_required'
  | 'catalog_unavailable'
  | 'config_error'
  | 'psn_not_set'
  | 'psn_not_verified'
  | 'psn_id_taken'
  | 'psn_account_locked'
  | 'psn_not_found'
  | 'psn_private'
  | 'psn_friend_required'
  | 'psn_unavailable'
  | 'npsso_invalid'
  | 'internal_error'
  | 'db_unavailable';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function ok<T>(data: T, init?: { headers?: HeadersInit }): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, headers: { ...NO_STORE, ...(init?.headers as Record<string, string>) } });
}

/**
 * Тяжёлые GET (статистика, план, итоги года; Фаза 47): ETag по телу ответа и `Cache-Control: private, no-cache`.
 * Браузер хранит ответ, но каждый раз сверяется с сервером (If-None-Match): совпало = 304 без тела.
 * ETag от тела, а не от времени синка: правки статусов/дат/плана меняют ответ без синка, сверка всегда верна.
 * Данные чужого входа не отдаются: сервер каждый раз проверяет сессию и считает тело заново; на выходе Clear-Site-Data.
 */
export function okRevalidated<T>(req: Request, data: T): Response {
  const body = JSON.stringify({ ok: true, data });
  const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
  const headers = { 'Cache-Control': 'private, no-cache', Vary: 'Cookie', ETag: etag };
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export function fail(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/** Относительный путь внутри сайта, иначе '/'. Отбрасывает //host, /\host, схемы и управляющие символы. */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  return next;
}

/** Если есть Origin, он должен совпадать с хостом запроса. */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * IP клиента для лимитов. На Vercel `x-vercel-forwarded-for` и `x-real-ip` ставит сама платформа (клиент их не подделает);
 * `x-forwarded-for` — запасной вариант (локально и в тестах), берётся первый адрес (повторный аудит P2-10).
 */
export function clientIp(req: Request): string {
  const first = (v: string | null) => v?.split(',')[0]?.trim() || '';
  return (first(req.headers.get('x-vercel-forwarded-for')) || first(req.headers.get('x-real-ip')) || first(req.headers.get('x-forwarded-for')) || 'unknown').slice(0, 64);
}
