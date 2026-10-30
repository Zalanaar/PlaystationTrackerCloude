// Конверт ответов API (контракт 4.1) и общие проверки запросов.
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
  | 'invalid_credentials'
  | 'not_found'
  | 'rate_limited'
  | 'sync_in_progress'
  | 'status_conflict'
  | 'month_exclusion_conflict'
  | 'planned_duplicate'
  | 'catalog_unavailable'
  | 'config_error'
  | 'internal_error'
  | 'db_unavailable';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function ok<T>(data: T, init?: { headers?: HeadersInit }): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, headers: { ...NO_STORE, ...(init?.headers as Record<string, string>) } });
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

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return (xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}
