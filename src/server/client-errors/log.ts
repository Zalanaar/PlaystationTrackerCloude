// П10: журнал ошибок браузера. Чистая проверка тела + запись с лимитом и сроком хранения + сводка для панели синка.
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';

const { clientErrors } = schema;

export const CLIENT_ERRORS_PER_HOUR = 30;
export const CLIENT_ERRORS_KEEP_DAYS = 30;
export const CLIENT_ERRORS_SUMMARY_DAYS = 7;
const DAY = 86_400_000;

export type ClientErrorInput = { kind: 'error' | 'rejection'; message: string; path: string | null; source: string | null; stack: string | null; ua: string | null };

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);

/** Адрес страницы без query и hash: в query бывают коды и токены (OAuth, NPSSO-формы). */
export function cleanPath(v: unknown): string | null {
  const s = str(v, 300);
  if (!s || !s.startsWith('/')) return null;
  return s.split(/[?#]/)[0].slice(0, 200);
}

/** Длинные токеноподобные строки (JWT, NPSSO, ключи) в тексте ошибки заменяются на «…». */
export function scrub(s: string): string {
  return s.replace(/[A-Za-z0-9_\-.]{40,}/g, '…');
}

export function parseClientError(body: unknown): { ok: true; value: ClientErrorInput } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Ожидается объект.' };
  const b = body as Record<string, unknown>;
  if (b.kind !== 'error' && b.kind !== 'rejection') return { ok: false, message: 'kind: error или rejection.' };
  const message = str(b.message, 500);
  if (!message) return { ok: false, message: 'Нужен message.' };
  const stack = str(b.stack, 2000);
  return {
    ok: true,
    value: {
      kind: b.kind, message: scrub(message), path: cleanPath(b.path), source: str(b.source, 300) && scrub(str(b.source, 300)!.split(/[?#]/)[0]),
      stack: stack && scrub(stack), ua: str(b.ua, 200),
    },
  };
}

/** Записать ошибку. false = лимит за час исчерпан (запись пропущена). Попутно чистит записи старше срока хранения. */
export async function recordClientError(db: AnyDb, userId: UserId, e: ClientErrorInput, now = new Date()): Promise<boolean> {
  await db.delete(clientErrors).where(and(eq(clientErrors.userId, userId), lt(clientErrors.createdAt, new Date(now.getTime() - CLIENT_ERRORS_KEEP_DAYS * DAY))));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(clientErrors)
    .where(and(eq(clientErrors.userId, userId), gte(clientErrors.createdAt, new Date(now.getTime() - 3_600_000))));
  if (Number(n) >= CLIENT_ERRORS_PER_HOUR) return false;
  await db.insert(clientErrors).values({ userId, createdAt: now, ...e });
  return true;
}

export type ClientErrorsSummary = { days: number; count: number; recent: { at: string; kind: 'error' | 'rejection'; message: string; path: string | null }[] };

/** Сводка для панели синка: число за 7 дней и 3 последних. */
export async function clientErrorsSummary(db: AnyDb, userId: UserId, now = new Date()): Promise<ClientErrorsSummary> {
  const since = new Date(now.getTime() - CLIENT_ERRORS_SUMMARY_DAYS * DAY);
  const where = and(eq(clientErrors.userId, userId), gte(clientErrors.createdAt, since));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(clientErrors).where(where);
  const rows = await db.select({ at: clientErrors.createdAt, kind: clientErrors.kind, message: clientErrors.message, path: clientErrors.path })
    .from(clientErrors).where(where).orderBy(desc(clientErrors.createdAt), desc(clientErrors.id)).limit(3);
  return {
    days: CLIENT_ERRORS_SUMMARY_DAYS,
    count: Number(n),
    recent: rows.map((r) => ({ at: r.at.toISOString(), kind: r.kind === 'rejection' ? 'rejection' : 'error', message: r.message, path: r.path })),
  };
}
