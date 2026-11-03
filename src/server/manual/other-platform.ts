// Фаза 44 (контракт 44): «Играл на другой платформе». Записи manual_games.kind = 'other_platform'.
// Пакет 5: отдельный блок Коллекции; статус △ ○ □ ✕, оценка и заметка в other_platform_meta. Без часов и трофеев.
// Ни Статистика, ни Итоги, ни Бэклог, ни План, ни прогнозы, ни счётчики шапки эти записи не читают. Склеенная с PS-игрой запись (linked_game_id) скрыта.
// Единственное влияние на остальное: rawg_id записи исключается из «У тебя нет» и советов (owned/marks.ts, любой kind). Вкус профиля не затрагивается.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { duplicateOf, loadDupIndex, ManualDuplicateError, ManualLimitError, ManualNotFoundError } from './store';
import type { OtherPlatformAddInput, OtherPlatformPatch, OtherStatus } from './validation';

const { manualGames: m, otherPlatformMeta: meta } = schema;

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
  /** Пакет 5: △ playing, ○ completed, □ backlog, ✕ dropped; null = не задан. */
  status: OtherStatus | null;
  statusChangedAt: string | null;
  /** 0..10 или null */
  rating: number | null;
  note: string | null;
};

type Row = typeof m.$inferSelect;
type Meta = { status: string | null; statusChangedAt: Date | null; rating: number | null; note: string | null } | null;

const toItem = (r: Row, x: Meta = null): OtherPlatformGame => ({
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
  status: (x?.status ?? null) as OtherStatus | null,
  statusChangedAt: x?.statusChangedAt ? x.statusChangedAt.toISOString() : null,
  rating: x?.rating ?? null,
  note: x?.note ?? null,
});

const own = (userId: UserId) => and(eq(m.userId, userId), eq(m.kind, 'other_platform'), isNull(m.linkedGameId));
// поля meta плоско: вложенный объект left join drizzle обнуляет целиком, если первые поля null (теряется заметка)
const metaCols = { mStatus: meta.status, mStatusChangedAt: meta.statusChangedAt, mRating: meta.rating, mNote: meta.note };

/** Записи с полями meta; до миграции 0033 (таблицы нет) — без них. Склеенные не входят. */
async function readRows(db: AnyDb, userId: UserId, id?: number): Promise<OtherPlatformGame[]> {
  const where = id === undefined ? own(userId) : and(own(userId), eq(m.id, id));
  try {
    const rows = await db
      .select({ r: m, ...metaCols })
      .from(m)
      .leftJoin(meta, and(eq(meta.manualGameId, m.id), eq(meta.userId, userId)))
      .where(where)
      .orderBy(desc(m.createdAt), desc(m.id));
    return rows.map((q) => toItem(q.r, { status: q.mStatus, statusChangedAt: q.mStatusChangedAt, rating: q.mRating, note: q.mNote }));
  } catch {
    const rows = await db.select().from(m).where(where).orderBy(desc(m.createdAt), desc(m.id));
    return rows.map((r) => toItem(r));
  }
}

/** Новые сверху. Только свои записи активного профиля; склеенные с PS-игрой («Это та игра?», пакет 5) не показываются. */
export async function listOtherPlatform(db: AnyDb, userId: UserId): Promise<OtherPlatformGame[]> {
  return readRows(db, userId);
}

/**
 * Пакет 5: платформа, статус, оценка, заметка. Только своя несклеенная запись other_platform, иначе ManualNotFoundError.
 * status_changed_at меняется только при смене статуса (null статус = null дата). Переданные поля пишутся как есть (null = очистить).
 */
export async function updateOtherPlatform(db: AnyDb, userId: UserId, id: number, p: OtherPlatformPatch, now: Date = new Date()): Promise<OtherPlatformGame> {
  const [cur] = await readRows(db, userId, id);
  if (!cur) throw new ManualNotFoundError();
  await db.transaction(async (tx) => {
    if (p.platformLabel !== undefined) {
      await tx.update(m).set({ platformLabel: p.platformLabel, updatedAt: now }).where(and(own(userId), eq(m.id, id)));
    }
    if (p.status === undefined && p.rating === undefined && p.note === undefined) return;
    const changed = p.status !== undefined && p.status !== cur.status;
    const row = {
      status: p.status !== undefined ? p.status : cur.status,
      statusChangedAt: changed ? (p.status === null ? null : now) : cur.statusChangedAt ? new Date(cur.statusChangedAt) : null,
      rating: p.rating !== undefined ? p.rating : cur.rating,
      note: p.note !== undefined ? p.note : cur.note,
      updatedAt: now,
    };
    await tx.insert(meta).values({ manualGameId: id, userId, ...row }).onConflictDoUpdate({ target: meta.manualGameId, set: row });
  });
  const [out] = await readRows(db, userId, id);
  if (!out) throw new ManualNotFoundError();
  return out;
}

/** Идемпотентно по (user_id, rawg_id, kind): повтор возвращает существующую запись без изменений (created: false). */
export async function addOtherPlatform(db: AnyDb, userId: UserId, v: OtherPlatformAddInput, now: Date = new Date()): Promise<{ item: OtherPlatformGame; created: boolean }> {
  const find = () => db.select().from(m).where(and(eq(m.userId, userId), eq(m.rawgId, v.externalId), eq(m.kind, 'other_platform')));
  const [existing] = await find();
  if (existing && existing.linkedGameId !== null) {
    // пакет 5: запись склеена с PS-игрой («Это та игра?» → да); явное повторное добавление возвращает её в блок
    await db.update(m).set({ linkedGameId: null, suggestedGameId: null, rejectedGameIds: sql`array_append(${m.rejectedGameIds}, ${existing.linkedGameId})`, updatedAt: now }).where(and(eq(m.userId, userId), eq(m.id, existing.id)));
  }
  if (existing) {
    const [item] = await readRows(db, userId, existing.id);
    return { item: item ?? toItem(existing), created: false };
  }
  // предупреждение о дубле с библиотекой/Планом, как в Бэклоге (43.2); пару в rejected_game_ids не пишем
  const dup = duplicateOf(await loadDupIndex(db, userId), v.externalId, v.title);
  if (dup && !v.confirmDuplicate) throw new ManualDuplicateError(dup);
  const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(m).where(own(userId));
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

/** RAWG id записей other_platform (и склеенных): для пометки «уже в списке» в результатах поиска. */
export async function otherPlatformRawgIds(db: AnyDb, userId: UserId): Promise<Set<string>> {
  const rows = await db.select({ id: m.rawgId }).from(m).where(and(eq(m.userId, userId), eq(m.kind, 'other_platform'), isNull(m.linkedGameId)));
  return new Set(rows.map((r) => r.id));
}
