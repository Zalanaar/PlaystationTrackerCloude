// Фаза 44 (контракт 44): «Играл на другой платформе». Записи manual_games.kind = 'other_platform'.
// Справочник без статуса, часов и трофеев: ни Статистика, ни Итоги, ни Бэклог, ни План, ни прогнозы эту таблицу не читают.
// Единственное влияние: rawg_id записи исключается из «У тебя нет» и советов (owned/marks.ts, любой kind). Вкус профиля не затрагивается.
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { duplicateOf, loadDupIndex, ManualDuplicateError, ManualLimitError, ManualNotFoundError } from './store';
import type { OtherPlatformAddInput } from './validation';

const { manualGames: m } = schema;

export const OTHER_PLATFORM_LIMIT = 300;

export type OtherPlatformGame = {
  id: number;
  source: 'manual';
  kind: 'other_platform';
  externalSource: 'rawg';
  externalId: string;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  platformLabel: string | null;
  createdAt: string;
};

type Row = typeof m.$inferSelect;

const toItem = (r: Row): OtherPlatformGame => ({
  id: r.id,
  source: 'manual',
  kind: 'other_platform',
  externalSource: 'rawg',
  externalId: r.rawgId,
  title: r.title,
  coverUrl: r.coverUrl,
  releaseDate: r.releaseDate,
  platformLabel: r.platformLabel,
  createdAt: r.createdAt.toISOString(),
});

/** Новые сверху. Только свои записи активного профиля. */
export async function listOtherPlatform(db: AnyDb, userId: UserId): Promise<OtherPlatformGame[]> {
  const rows = await db.select().from(m).where(and(eq(m.userId, userId), eq(m.kind, 'other_platform'))).orderBy(desc(m.createdAt), desc(m.id));
  return rows.map(toItem);
}

/** Идемпотентно по (user_id, rawg_id, kind): повтор возвращает существующую запись без изменений (created: false). */
export async function addOtherPlatform(db: AnyDb, userId: UserId, v: OtherPlatformAddInput, now: Date = new Date()): Promise<{ item: OtherPlatformGame; created: boolean }> {
  const find = () => db.select().from(m).where(and(eq(m.userId, userId), eq(m.rawgId, v.externalId), eq(m.kind, 'other_platform')));
  const [existing] = await find();
  if (existing) return { item: toItem(existing), created: false };
  // предупреждение о дубле с библиотекой/Планом, как в Бэклоге (43.2); пару в rejected_game_ids не пишем: склейки у этого kind нет
  const dup = duplicateOf(await loadDupIndex(db, userId), v.externalId, v.title);
  if (dup && !v.confirmDuplicate) throw new ManualDuplicateError(dup);
  const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(m).where(and(eq(m.userId, userId), eq(m.kind, 'other_platform')));
  if ((cnt?.n ?? 0) >= OTHER_PLATFORM_LIMIT) throw new ManualLimitError(OTHER_PLATFORM_LIMIT);
  const ins = await db
    .insert(m)
    .values({ userId, rawgId: v.externalId, title: v.title, coverUrl: v.coverUrl, releaseDate: v.releaseDate, kind: 'other_platform', notPurchased: false, platformLabel: v.platformLabel, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning();
  if (ins.length > 0) return { item: toItem(ins[0]), created: true };
  const [again] = await find();
  if (!again) throw new ManualNotFoundError();
  return { item: toItem(again), created: false };
}

/** RAWG id записей other_platform: для пометки «уже в списке» в результатах поиска. */
export async function otherPlatformRawgIds(db: AnyDb, userId: UserId): Promise<Set<string>> {
  const rows = await db.select({ id: m.rawgId }).from(m).where(and(eq(m.userId, userId), eq(m.kind, 'other_platform')));
  return new Set(rows.map((r) => r.id));
}
