// Фаза 43 (контракт 43): игры «не куплено» в Бэклоге. Каждый запрос несёт user_id активного профиля.
// manual_games не входит ни в games, ни в game_status: Статистика, Итоги, часы, прогноз платины этих записей не видят по построению.
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { libraryKey } from '@/server/recommend/discover-rank';
import { buildGroups, type LibraryGroup } from './match';
import type { ManualAddInput } from './validation';

const { manualGames: m, games: g, gameStatus: gs, plannedGames: pg, ownedMarks: om } = schema;

export const MANUAL_LIMIT = 200;

export type GameRef = { gameId: number; name: string; imageUrl: string | null };

export type ManualGame = {
  id: number;
  source: 'manual';
  kind: 'ps_backlog';
  externalSource: 'rawg';
  externalId: string;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  status: 'backlog';
  notPurchased: boolean;
  /** Неуверенное совпадение с игрой библиотеки, ждёт ответа «Это та игра?» */
  matchSuggestion: GameRef | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualMatch = {
  id: number;
  title: string;
  coverUrl: string | null;
  notPurchased: boolean;
  /** Пакет 5: 'other_platform' = запись «с другой платформы» (купил на PS?). Необязательное в типе (фикстуры UI). */
  kind?: 'ps_backlog' | 'other_platform';
  platformLabel?: string | null;
  game: GameRef & { lastPlayedAt: string | null; hours: number };
};

export type DuplicateInfo = { duplicate: 'library' | 'planned'; game: GameRef | null; planned: { id: number; title: string; status: string } | null };

export class ManualNotFoundError extends Error {
  constructor() {
    super('manual_not_found');
  }
}
export class ManualDuplicateError extends Error {
  constructor(readonly info: DuplicateInfo) {
    super('duplicate_game');
  }
}
export class ManualLimitError extends Error {
  constructor(readonly limit: number = MANUAL_LIMIT) {
    super('manual_limit');
  }
}

type Row = typeof m.$inferSelect;

const toItem = (r: Row, s: GameRef | null): ManualGame => ({
  id: r.id,
  source: 'manual',
  kind: 'ps_backlog',
  externalSource: 'rawg',
  externalId: r.rawgId,
  title: r.title,
  coverUrl: r.coverUrl,
  releaseDate: r.releaseDate,
  status: 'backlog',
  notPurchased: r.notPurchased,
  matchSuggestion: s,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function readOne(db: AnyDb, userId: UserId, id: number): Promise<ManualGame> {
  const rows = await readList(db, userId, { id });
  if (rows.length === 0) throw new ManualNotFoundError();
  return rows[0];
}

async function readList(db: AnyDb, userId: UserId, o: { nb?: boolean; id?: number }): Promise<ManualGame[]> {
  const rows = await db
    .select({ r: m, gName: g.name, gImage: g.imageUrl })
    .from(m)
    .leftJoin(g, and(eq(g.userId, m.userId), eq(g.id, m.suggestedGameId)))
    .where(and(eq(m.userId, userId), eq(m.kind, 'ps_backlog'), isNull(m.linkedGameId), o.nb ? eq(m.notPurchased, true) : undefined, o.id !== undefined ? eq(m.id, o.id) : undefined))
    .orderBy(desc(m.createdAt), desc(m.id));
  return rows.map((x) => toItem(x.r, x.r.suggestedGameId === null ? null : { gameId: x.r.suggestedGameId, name: x.gName ?? '', imageUrl: x.gImage }));
}

/** Записи Бэклога (без склеенных с библиотекой). nb = только «не куплено». */
export function listManual(db: AnyDb, userId: UserId, opts: { nb?: boolean } = {}): Promise<ManualGame[]> {
  return readList(db, userId, { nb: opts.nb });
}

// --- дубли

type DupIndex = {
  groups: LibraryGroup[];
  byKey: Map<string, LibraryGroup>;
  coveredByRawg: Map<string, number>;
  linkedByRawg: Map<string, number>;
  backlogRawg: Set<string>;
  otherRawg: Set<string>;
  plannedById: Map<string, { id: number; title: string; status: string }>;
  plannedByKey: Map<string, { id: number; title: string; status: string }>;
};

export async function loadDupIndex(db: AnyDb, userId: UserId): Promise<DupIndex> {
  const [rows, marks, manual, planned] = await Promise.all([
    db
      .select({ id: g.id, name: g.name, imageUrl: g.imageUrl, duplicateOfGameId: g.duplicateOfGameId, hiddenAt: g.hiddenAt, lastPlayedAt: g.lastPlayedAt, playDurationSeconds: g.playDurationSeconds })
      .from(g)
      .where(eq(g.userId, userId)),
    db.select({ rawgId: om.rawgId, gameId: om.coveredByGameId }).from(om).where(and(eq(om.userId, userId), isNotNull(om.coveredByGameId))).catch(() => []),
    db.select({ rawgId: m.rawgId, linked: m.linkedGameId, unlinked: isNull(m.linkedGameId), kind: m.kind }).from(m).where(eq(m.userId, userId)),
    db.select({ id: pg.id, title: pg.title, status: pg.status, source: pg.externalSource, extId: pg.externalId }).from(pg).where(and(eq(pg.userId, userId), inArray(pg.status, ['planned', 'done']))),
  ]);
  const groups = buildGroups(rows);
  const byKey = new Map<string, LibraryGroup>();
  for (const grp of groups) for (const k of grp.keys) if (!byKey.has(k)) byKey.set(k, grp);
  const plannedById = new Map<string, { id: number; title: string; status: string }>();
  const plannedByKey = new Map<string, { id: number; title: string; status: string }>();
  for (const p of planned) {
    const v = { id: p.id, title: p.title, status: p.status };
    if (p.source === 'rawg' && p.extId) plannedById.set(p.extId, v);
    const k = libraryKey(p.title);
    if (k && !plannedByKey.has(k)) plannedByKey.set(k, v);
  }
  return {
    groups,
    byKey,
    coveredByRawg: new Map(marks.flatMap((x) => (x.gameId === null ? [] : [[x.rawgId, x.gameId] as const]))),
    linkedByRawg: new Map(manual.filter((x) => x.kind === 'ps_backlog').flatMap((x) => (x.linked === null ? [] : [[x.rawgId, x.linked] as const]))),
    backlogRawg: new Set(manual.filter((x) => x.kind === 'ps_backlog' && x.unlinked).map((x) => x.rawgId)),
    otherRawg: new Set(manual.filter((x) => x.kind === 'other_platform').map((x) => x.rawgId)),
    plannedById,
    plannedByKey,
  };
}

const ref = (grp: LibraryGroup): GameRef => ({ gameId: grp.primaryId, name: grp.name, imageUrl: grp.imageUrl });

export function duplicateOf(ix: DupIndex, rawgId: string, title: string): DuplicateInfo | null {
  const gid = ix.coveredByRawg.get(rawgId) ?? ix.linkedByRawg.get(rawgId);
  const key = libraryKey(title);
  const grp = (gid !== undefined ? ix.groups.find((x) => x.memberIds.includes(gid)) : undefined) ?? (key ? ix.byKey.get(key) : undefined);
  if (grp) return { duplicate: 'library', game: ref(grp), planned: null };
  const pl = ix.plannedById.get(rawgId) ?? (key ? ix.plannedByKey.get(key) : undefined);
  if (pl) return { duplicate: 'planned', game: null, planned: pl };
  return null;
}

export type CandidateFlags = { duplicate: 'library' | 'planned' | null; inBacklog: boolean; inList: boolean };

export async function flagCandidates<T extends { externalId: string; title: string }>(db: AnyDb, userId: UserId, cands: readonly T[]): Promise<(T & CandidateFlags)[]> {
  const ix = await loadDupIndex(db, userId);
  return cands.map((c) => ({ ...c, duplicate: duplicateOf(ix, c.externalId, c.title)?.duplicate ?? null, inBacklog: ix.backlogRawg.has(c.externalId), inList: ix.otherRawg.has(c.externalId) }));
}

// --- запись

export async function addManual(db: AnyDb, userId: UserId, v: ManualAddInput, now: Date = new Date()): Promise<{ item: ManualGame; created: boolean }> {
  const [existing] = await db.select().from(m).where(and(eq(m.userId, userId), eq(m.rawgId, v.externalId), eq(m.kind, 'ps_backlog')));
  if (existing && existing.linkedGameId === null) return { item: await readOne(db, userId, existing.id), created: false };
  const dup = duplicateOf(await loadDupIndex(db, userId), v.externalId, v.title);
  if (dup && !v.confirmDuplicate) throw new ManualDuplicateError(dup);
  // «Всё равно добавить» поверх игры библиотеки: пара запоминается, синк её не склеивает и не предлагает (QA-43-1)
  const rejectGid = v.confirmDuplicate && dup?.duplicate === 'library' && dup.game ? dup.game.gameId : null;
  if (existing) {
    // запись была склеена с библиотекой, пользователь явно подтвердил повторное добавление
    await db.update(m).set({ linkedGameId: null, suggestedGameId: null, notPurchased: v.notPurchased ?? true, title: v.title, coverUrl: v.coverUrl, releaseDate: v.releaseDate, ...(rejectGid !== null && !existing.rejectedGameIds.includes(rejectGid) ? { rejectedGameIds: [...existing.rejectedGameIds, rejectGid] } : {}), updatedAt: now }).where(and(eq(m.userId, userId), eq(m.id, existing.id)));
    return { item: await readOne(db, userId, existing.id), created: true };
  }
  const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(m).where(and(eq(m.userId, userId), eq(m.kind, 'ps_backlog'), isNull(m.linkedGameId)));
  if ((cnt?.n ?? 0) >= MANUAL_LIMIT) throw new ManualLimitError();
  const ins = await db
    .insert(m)
    .values({ userId, rawgId: v.externalId, title: v.title, coverUrl: v.coverUrl, releaseDate: v.releaseDate, kind: 'ps_backlog', notPurchased: v.notPurchased ?? true, ...(rejectGid !== null ? { rejectedGameIds: [rejectGid] } : {}), createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: m.id });
  if (ins.length === 0) {
    const [again] = await db.select({ id: m.id }).from(m).where(and(eq(m.userId, userId), eq(m.rawgId, v.externalId), eq(m.kind, 'ps_backlog')));
    if (!again) throw new ManualNotFoundError();
    return { item: await readOne(db, userId, again.id), created: false };
  }
  return { item: await readOne(db, userId, ins[0].id), created: true };
}

export type BatchResult =
  | { index: number; externalId: string; status: 'created' | 'exists'; item: ManualGame }
  | { index: number; externalId: string; status: 'duplicate'; code: 'duplicate_game'; details: DuplicateInfo }
  | { index: number; externalId: string; status: 'error'; code: 'manual_limit' | 'db_unavailable' };

/** Фаза 43.1: пакетное добавление. Элементы независимы, ошибка одного не откатывает остальные. Идемпотентно. */
export async function addManualBatch(db: AnyDb, userId: UserId, items: readonly ManualAddInput[], now: Date = new Date()): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (const [index, v] of items.entries()) {
    const externalId = v.externalId;
    try {
      const r = await addManual(db, userId, v, now);
      out.push(r.created ? { index, externalId, status: 'created', item: r.item } : { index, externalId, status: 'exists', item: r.item });
    } catch (e) {
      if (e instanceof ManualDuplicateError) out.push({ index, externalId, status: 'duplicate', code: 'duplicate_game', details: e.info });
      else if (e instanceof ManualLimitError) out.push({ index, externalId, status: 'error', code: 'manual_limit' });
      else out.push({ index, externalId, status: 'error', code: 'db_unavailable' });
    }
  }
  return out;
}

/** «Купил» (false) и «Отменить» (true). Идемпотентно. Только несклеенные записи этого пользователя. */
export async function setNotPurchased(db: AnyDb, userId: UserId, id: number, notPurchased: boolean, now: Date = new Date()): Promise<ManualGame> {
  const rows = await db
    .update(m)
    .set({ notPurchased, updatedAt: now })
    .where(and(eq(m.userId, userId), eq(m.id, id), eq(m.kind, 'ps_backlog'), isNull(m.linkedGameId)))
    .returning({ id: m.id });
  if (rows.length === 0) throw new ManualNotFoundError();
  return readOne(db, userId, id);
}

export async function removeManual(db: AnyDb, userId: UserId, id: number): Promise<boolean> {
  const rows = await db.delete(m).where(and(eq(m.userId, userId), eq(m.id, id))).returning({ id: m.id });
  return rows.length > 0;
}

/** Статус смены для записи «не куплено» запрещён: true = запись существует (несклеенная). */
export async function manualExists(db: AnyDb, userId: UserId, id: number): Promise<boolean> {
  const rows = await db.select({ id: m.id }).from(m).where(and(eq(m.userId, userId), eq(m.id, id), eq(m.kind, 'ps_backlog'), isNull(m.linkedGameId)));
  return rows.length > 0;
}

/**
 * Склеивает запись с игрой библиотеки (главной в группе дублей): снимает пометку, убирает вопрос, переносит статус `backlog`,
 * если у игры своего статуса ещё нет (status_changed_at = когда запись попала в Бэклог). Существующий статус не трогаем.
 * Вызывающий гарантирует, что игра принадлежит userId. Идемпотентно (false = запись уже склеена или удалена).
 */
export async function linkToGame(db: AnyDb, userId: UserId, manualId: number, gameId: number, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(m)
      .set({ linkedGameId: gameId, notPurchased: false, suggestedGameId: null, updatedAt: now })
      .where(and(eq(m.userId, userId), eq(m.id, manualId), isNull(m.linkedGameId)))
      .returning({ createdAt: m.createdAt, kind: m.kind });
    if (rows.length === 0) return false;
    // пакет 5: запись «с другой платформы» просто скрывается, статус PS-игры не трогаем
    if (rows[0].kind === 'other_platform') return true;
    await tx.insert(gs).values({ gameId, userId, status: 'backlog', statusChangedAt: rows[0].createdAt, createdAt: now, updatedAt: now }).onConflictDoNothing();
    return true;
  });
}

// --- «Это та игра?»

export async function listMatches(db: AnyDb, userId: UserId): Promise<ManualMatch[]> {
  const rows = await db
    .select({ r: m, gName: g.name, gImage: g.imageUrl, last: g.lastPlayedAt, sec: g.playDurationSeconds })
    .from(m)
    .innerJoin(g, and(eq(g.userId, m.userId), eq(g.id, m.suggestedGameId)))
    .where(and(eq(m.userId, userId), inArray(m.kind, ['ps_backlog', 'other_platform']), isNull(m.linkedGameId), isNotNull(m.suggestedGameId)))
    .orderBy(asc(m.createdAt), asc(m.id));
  return rows.map((x) => ({
    id: x.r.id,
    title: x.r.title,
    coverUrl: x.r.coverUrl,
    notPurchased: x.r.notPurchased,
    kind: x.r.kind === 'other_platform' ? 'other_platform' : 'ps_backlog',
    platformLabel: x.r.platformLabel,
    game: { gameId: x.r.suggestedGameId as number, name: x.gName, imageUrl: x.gImage, lastPlayedAt: x.last ? x.last.toISOString() : null, hours: Math.round(x.sec / 36) / 100 },
  }));
}

export async function countMatches(db: AnyDb, userId: UserId): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(g, and(eq(g.userId, m.userId), eq(g.id, m.suggestedGameId)))
    .where(and(eq(m.userId, userId), inArray(m.kind, ['ps_backlog', 'other_platform']), isNull(m.linkedGameId), isNotNull(m.suggestedGameId)));
  return r?.n ?? 0;
}

/** «Да» склеивает с предложенной игрой (id игры берётся из БД, не от клиента); «Нет» запоминает пару и больше не предлагает. */
export async function answerMatch(db: AnyDb, userId: UserId, id: number, answer: 'yes' | 'no', now: Date = new Date()): Promise<{ linked: GameRef | null }> {
  const [rec] = await db
    .select({ r: m, gName: g.name, gImage: g.imageUrl })
    .from(m)
    .innerJoin(g, and(eq(g.userId, m.userId), eq(g.id, m.suggestedGameId)))
    .where(and(eq(m.userId, userId), eq(m.id, id), isNull(m.linkedGameId), isNotNull(m.suggestedGameId)));
  if (!rec) throw new ManualNotFoundError();
  const gid = rec.r.suggestedGameId as number;
  if (answer === 'yes') {
    await linkToGame(db, userId, id, gid, now);
    return { linked: { gameId: gid, name: rec.gName, imageUrl: rec.gImage } };
  }
  await db
    .update(m)
    .set({ suggestedGameId: null, rejectedGameIds: sql`array_append(${m.rejectedGameIds}, ${gid})`, updatedAt: now })
    .where(and(eq(m.userId, userId), eq(m.id, id)));
  return { linked: null };
}

/** RAWG id всех записей manual_games пользователя (любой вид): исключаются из «У тебя нет» и поиска в План. */
export async function manualRawgIds(db: AnyDb, userId: UserId): Promise<Set<string>> {
  const rows = await db.select({ id: m.rawgId }).from(m).where(eq(m.userId, userId));
  return new Set(rows.map((r) => r.id));
}
