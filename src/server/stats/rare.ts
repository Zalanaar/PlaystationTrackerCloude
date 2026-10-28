// «Редкие трофеи» (контракт 14.1). Чистые функции: маппинг строки и порядок. Выборка в rare-query.ts.
import type { RareTrophy } from './types';

export const RARE_LIMIT = 5;

export type RareRow = {
  setId: number;
  trophyId: number;
  type: RareTrophy['type'];
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
  earnedAt: Date | null;
  /** numeric(5,2) приходит строкой */
  earnedRate: string | null;
  rarity: number | null;
  setName: string;
  gameId: number | null;
  gameTitle: string | null;
  gameCoverUrl: string | null;
};

const rate = (r: string | null): number | null => {
  if (r === null) return null;
  const n = Number(r);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** Порядок 14.1: earned_rate asc, earned_at asc (null в конце), setId, trophyId. Без процента в топ не попадает. */
export function compareRare(a: RareRow, b: RareRow): number {
  const ra = rate(a.earnedRate) ?? Infinity;
  const rb = rate(b.earnedRate) ?? Infinity;
  if (ra !== rb) return ra - rb;
  const ta = a.earnedAt?.getTime() ?? Infinity;
  const tb = b.earnedAt?.getTime() ?? Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.setId - b.setId || a.trophyId - b.trophyId;
}

export function toRareTrophy(r: RareRow): RareTrophy {
  return {
    setId: r.setId,
    trophyId: r.trophyId,
    type: r.type,
    name: r.name,
    detail: r.detail,
    iconUrl: r.iconUrl,
    earnedAt: r.earnedAt ? r.earnedAt.toISOString() : null,
    earnedRate: rate(r.earnedRate) as number,
    rarity: r.rarity,
    setName: r.setName,
    game: r.gameId === null ? null : { id: r.gameId, title: r.gameTitle ?? '', coverUrl: r.gameCoverUrl },
  };
}

/** Топ редких: отбрасывает строки без процента, сортирует, режет до limit. SQL уже отдаёт <= limit строк в этом порядке. */
export function pickRare(rows: readonly RareRow[], limit = RARE_LIMIT): RareTrophy[] {
  return rows
    .filter((r) => rate(r.earnedRate) !== null)
    .slice()
    .sort(compareRare)
    .slice(0, limit)
    .map(toRareTrophy);
}
