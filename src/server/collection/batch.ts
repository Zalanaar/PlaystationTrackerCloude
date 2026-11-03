// Выборки 9.2 пакетом (контракт 48.1): общий код GET /api/games/batch и серверного первого экрана `/` (item 4).
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { listGames } from './query';
import type { GamesBatchResponse } from './types';
import { parseListQuery, type ListQuery } from './validation';

/** Сколько выборок в одном запросе: хроника «Все» = 6 блоков, запас на будущие блоки. */
export const BATCH_MAX = 8;

/** Параметры `b` → выборки; ошибка с текстом для 400. */
export function parseBatch(sp: URLSearchParams): { ok: true; value: ListQuery[] } | { ok: false; message: string } {
  const raw = sp.getAll('b');
  if (raw.length === 0 || raw.length > BATCH_MAX) return { ok: false, message: `Нужно от 1 до ${BATCH_MAX} параметров b.` };
  const out: ListQuery[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = parseListQuery(new URLSearchParams(raw[i]));
    if (!p.ok) return { ok: false, message: `b[${i}]: ${p.message}` };
    out.push(p.value);
  }
  return { ok: true, value: out };
}

/** Все выборки параллельно; упавшая не роняет остальные. null = упали все (503). */
export async function runGamesBatch(db: AnyDb, userId: UserId, queries: readonly ListQuery[], now: Date): Promise<GamesBatchResponse | null> {
  const settled = await Promise.allSettled(queries.map((q) => listGames(db, userId, q, now)));
  if (settled.every((r) => r.status === 'rejected')) return null;
  return {
    results: settled.map((r) => (r.status === 'fulfilled' ? { ok: true as const, data: r.value } : { ok: false as const, code: 'db_unavailable' as const })),
  };
}
