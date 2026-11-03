// Пул и сводка коллекции из данных сервера (item 4): первый экран `/` рисуется из HTML, без запросов после гидрации.
import type { CollectionInitial, GameItem, GamesListResponse } from '@/server/collection/types';
import { forgottenCountOf } from '../../triage/forgotten';
import { gamesBatchUrl, settleBatch } from '../api';
import { buildPlan, inBlock, type PlanItem } from '../blocks';
import { isChronicleMode, type Filters } from '../filters';
import { markSlim } from '../slim';
import { union, type Pool } from './pool';

/** Пул хроники из ответов блоков. null: не пришёл ни один блок. prev: ранее загруженные игры (остаются у упавших блоков). */
export function chroniclePool(plan: readonly PlanItem[], rs: readonly PromiseSettledResult<GamesListResponse>[], prev: readonly GameItem[], f: Filters): Pool | null {
  const ok = rs.flatMap((r, i) => (r.status === 'fulfilled' ? [{ block: plan[i].block, r: r.value }] : []));
  if (ok.length === 0) return null;
  const failed = plan.filter((_, i) => rs[i].status === 'rejected').map((p) => p.block);
  const kept = prev.filter((g) => failed.some((b) => inBlock(g, b, f.status)));
  const chron = ok.find((x) => x.block === 'chronicle');
  return { items: union([...ok.map((x) => x.r.items), kept]), counts: ok[0].r.counts, total: chron ? chron.r.total : ok[0].r.total, failed, forgotten: forgottenCountOf(ok[0].r.forgottenCount), order: f.order ?? 'desc' };
}

export type Seed = { summary: CollectionInitial['summary']; pool: Pool; initial: CollectionInitial };

/**
 * Данные сервера подходят к текущим фильтрам: тот же план блоков даёт тот же URL пакета. Платина дозагружается на клиенте, её не сеем.
 * Иначе null: клиент грузит как раньше.
 */
export function seedFromInitial(initial: CollectionInitial | null | undefined, f: Filters): Seed | null {
  if (!initial || !isChronicleMode(f) || f.platinum) return null;
  const plan = buildPlan(f.status, f.q, f.platinum);
  if (gamesBatchUrl(plan.map((p) => p.query)) !== initial.batchUrl) return null;
  if (!Array.isArray(initial.batch?.results) || initial.batch.results.length !== plan.length) return null;
  const pool = chroniclePool(plan, settleBatch(initial.batch), [], f);
  if (!pool) return null;
  if (initial.slim) {
    markSlim(pool.items);
    markSlim(initial.summary.playing);
    markSlim(initial.summary.nearPlatinum.map((n) => n.game));
  }
  return { summary: initial.summary, pool, initial };
}
