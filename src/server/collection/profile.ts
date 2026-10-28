// Профиль PSN из таблицы psn_profile (контракт 12.1, 12.3). Токенов в таблице нет.
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { PsnProfile } from './types';

const { psnProfile } = schema;

export type ProfileRow = typeof psnProfile.$inferSelect;

/** Строка БД -> ответ API. Счётчики трофеев целиком null, если нет ни одного из четырёх. */
export function toPsnProfile(r: ProfileRow): PsnProfile {
  const counts = [r.earnedPlatinum, r.earnedGold, r.earnedSilver, r.earnedBronze];
  const hasCounts = counts.every((c) => c !== null);
  const [platinum, gold, silver, bronze] = counts.map((c) => c ?? 0);
  return {
    onlineId: r.onlineId,
    avatarUrl: r.avatarUrl,
    level: r.trophyLevel,
    levelProgress: r.trophyProgress,
    tier: r.trophyTier,
    trophies: hasCounts ? { platinum, gold, silver, bronze, total: platinum + gold + silver + bronze } : null,
  };
}

export async function getPsnProfile(db: AnyDb): Promise<PsnProfile | null> {
  const [row] = await db.select().from(psnProfile).where(eq(psnProfile.id, 1)).limit(1);
  return row ? toPsnProfile(row) : null;
}
