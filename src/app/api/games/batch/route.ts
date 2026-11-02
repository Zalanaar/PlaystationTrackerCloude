import { getDb } from '@/db';
import { listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { fail, okRevalidated } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import type { GamesBatchResponse } from '@/server/collection/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Сколько выборок в одном запросе: хроника «Все» = 6 блоков, запас на будущие блоки. */
const BATCH_MAX = 8;

// Блоки хроники одним запросом (Фаза 48, контракт 48.1): каждый `b` = query-строка 9.2, ответ по порядку.
// Одна проверка сессии и один круг сети вместо шести; упавший блок не роняет остальные.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const raw = new URL(req.url).searchParams.getAll('b');
  if (raw.length === 0 || raw.length > BATCH_MAX) return fail(400, 'invalid_request', `Нужно от 1 до ${BATCH_MAX} параметров b.`);
  const parsed = raw.map((b) => parseListQuery(new URLSearchParams(b)));
  const bad = parsed.findIndex((p) => !p.ok);
  if (bad >= 0) {
    const p = parsed[bad];
    return fail(400, 'invalid_request', `b[${bad}]: ${p.ok ? '' : p.message}`);
  }
  const db = getDb();
  const now = new Date();
  const settled = await Promise.allSettled(parsed.map((p) => (p.ok ? listGames(db, a.user.id, p.value, now) : Promise.reject(new Error('unreachable')))));
  if (settled.every((r) => r.status === 'rejected')) return fail(503, 'db_unavailable', 'База данных недоступна.');
  const data: GamesBatchResponse = {
    results: settled.map((r) => (r.status === 'fulfilled' ? { ok: true as const, data: r.value } : { ok: false as const, code: 'db_unavailable' as const })),
  };
  return okRevalidated(req, data);
}
