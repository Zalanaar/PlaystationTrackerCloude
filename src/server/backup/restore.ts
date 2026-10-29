// Восстановление разметки из файла копии (контракт 20.3): план (preview) и применение (apply) одной и той же функцией плана.
// Правило: только добавляет и перезаписывает значениями из файла, ничего не удаляет; пустое (null) в файле значение в БД не трогает.
import { eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { snapshotAllStatuses } from '@/server/collection/mutations';
import type { BackupFile, BackupPlanned } from './format';

const { games, gameStatus, roadmapOrder, roadmapExcluded, gameMonthExclusions, plannedGames, roadmapSettings } = schema;

export const SECTIONS = ['status', 'duration', 'genres', 'hidden', 'roadmapOrder', 'roadmapExcluded', 'monthExclusions', 'plannedGames', 'roadmapSettings'] as const;
export type Section = (typeof SECTIONS)[number];
export type SectionCounts = { add: number; change: number; unchanged: number; skipped: number };
export const CHANGES_LIMIT = 100;
export const MISSING_LIMIT = 50;

export type RestoreChange = { section: Section; kind: 'add' | 'change'; titleId: string | null; name: string; from: string | null; to: string };
export type RestoreReport = {
  sections: Record<Section, SectionCounts>;
  changes: RestoreChange[];
  changesTruncated: boolean;
  missing: { titleId: string; name: string }[];
};

type Op =
  | { t: 'status'; gameId: number; value: (typeof gameStatus.$inferInsert)['status']; completedAt: Date | null; droppedAt: Date | null; statusChangedAt: Date }
  | { t: 'duration'; gameId: number; hours: number }
  | { t: 'genres'; gameId: number; genres: string[] }
  | { t: 'hidden'; gameId: number; at: Date }
  | { t: 'order'; gameId: number; position: number }
  | { t: 'excluded'; gameId: number }
  | { t: 'month'; gameId: number; month: string }
  | { t: 'planned'; id: number | null; values: typeof plannedGames.$inferInsert }
  | { t: 'settings'; year: number; hoursPerWeek: number };

export type RestorePlan = { ops: Op[]; report: RestoreReport };

const sameTime = (a: Date | null, b: string | null) => (a === null ? b === null : b !== null && a.getTime() === new Date(b).getTime());
const sortedKey = (a: readonly string[]) => [...a].sort().join(',');
const pk = (p: { title: string; releaseDate: string | null }) => `${p.title.trim().toLowerCase()}|${p.releaseDate ?? ''}`;

/** Значения планируемой игры: пустые (null) поля файла не затирают текущие (если запись уже есть). */
function plannedValues(fp: BackupPlanned, cur: typeof plannedGames.$inferSelect | null): typeof plannedGames.$inferInsert {
  return {
    title: fp.title,
    releaseDate: fp.releaseDate ?? cur?.releaseDate ?? null,
    coverUrl: fp.coverUrl ?? cur?.coverUrl ?? null,
    wantAtRelease: fp.wantAtRelease,
    hoursManual: fp.hoursManual ?? cur?.hoursManual ?? null,
    externalSource: fp.externalSource ?? cur?.externalSource ?? null,
    externalId: fp.externalId ?? cur?.externalId ?? null,
    status: fp.status,
  };
}

/** Строит план по текущему состоянию БД и файлу. Только чтение. */
export async function planRestore(db: AnyDb, file: BackupFile): Promise<RestorePlan> {
  const [gameRows, statuses, orders, excluded, months, planned, settings] = await Promise.all([
    db.select({ id: games.id, titleId: games.titleId, duration: games.durationOverrideHours, genres: games.genresOverride, hiddenAt: games.hiddenAt }).from(games),
    db.select().from(gameStatus),
    db.select().from(roadmapOrder),
    db.select().from(roadmapExcluded),
    db.select().from(gameMonthExclusions),
    db.select().from(plannedGames),
    db.select().from(roadmapSettings),
  ]);
  const byTitle = new Map(gameRows.map((g) => [g.titleId, g]));
  const statusBy = new Map(statuses.map((s) => [s.gameId, s]));
  const orderBy = new Map(orders.map((o) => [o.gameId, o.position]));
  const excludedSet = new Set(excluded.map((e) => e.gameId));
  const monthSet = new Set(months.map((m) => `${m.gameId}|${m.month}`));

  const sections = Object.fromEntries(SECTIONS.map((s) => [s, { add: 0, change: 0, unchanged: 0, skipped: 0 }])) as Record<Section, SectionCounts>;
  const ops: Op[] = [];
  const changes: RestoreChange[] = [];
  const missing = new Map<string, string>();
  const fileOrder = new Map<number, number>(); // игра -> позиция из файла (для нормализации очереди)
  const note = (section: Section, kind: 'add' | 'change', titleId: string | null, name: string, from: string | null, to: string) => {
    sections[section][kind]++;
    changes.push({ section, kind, titleId, name, from, to });
  };

  for (const fg of file.games) {
    const name = fg.name ?? fg.titleId;
    const g = byTitle.get(fg.titleId);
    const skip = (section: Section) => {
      sections[section].skipped++;
      missing.set(fg.titleId, name);
    };

    // статус
    if (fg.status) {
      if (!g) skip('status');
      else {
        const cur = statusBy.get(g.id);
        const completedAt = fg.status.completedAt ? new Date(fg.status.completedAt) : null;
        const droppedAt = fg.status.droppedAt ? new Date(fg.status.droppedAt) : null;
        const op: Op = { t: 'status', gameId: g.id, value: fg.status.value, completedAt, droppedAt, statusChangedAt: new Date(fg.status.statusChangedAt) };
        if (!cur) {
          ops.push(op);
          note('status', 'add', fg.titleId, name, null, fg.status.value);
        } else if (cur.status !== fg.status.value || !sameTime(cur.completedAt, fg.status.completedAt) || !sameTime(cur.droppedAt, fg.status.droppedAt)) {
          ops.push(op);
          note('status', 'change', fg.titleId, name, cur.status, fg.status.value);
        } else sections.status.unchanged++;
      }
    }
    // длительность
    if (fg.durationOverrideHours !== null) {
      if (!g) skip('duration');
      else if (g.duration === null) {
        ops.push({ t: 'duration', gameId: g.id, hours: fg.durationOverrideHours });
        note('duration', 'add', fg.titleId, name, null, String(fg.durationOverrideHours));
      } else if (Math.abs(g.duration - fg.durationOverrideHours) > 1e-9) {
        ops.push({ t: 'duration', gameId: g.id, hours: fg.durationOverrideHours });
        note('duration', 'change', fg.titleId, name, String(g.duration), String(fg.durationOverrideHours));
      } else sections.duration.unchanged++;
    }
    // жанры
    if (fg.genresOverride && fg.genresOverride.length > 0) {
      if (!g) skip('genres');
      else if (!g.genres || g.genres.length === 0) {
        ops.push({ t: 'genres', gameId: g.id, genres: fg.genresOverride });
        note('genres', 'add', fg.titleId, name, null, fg.genresOverride.join(','));
      } else if (sortedKey(g.genres) !== sortedKey(fg.genresOverride)) {
        ops.push({ t: 'genres', gameId: g.id, genres: fg.genresOverride });
        note('genres', 'change', fg.titleId, name, g.genres.join(','), fg.genresOverride.join(','));
      } else sections.genres.unchanged++;
    }
    // скрытие (булево: уже скрытая остаётся с прежней датой)
    if (fg.hiddenAt !== null) {
      if (!g) skip('hidden');
      else if (g.hiddenAt === null) {
        ops.push({ t: 'hidden', gameId: g.id, at: new Date(fg.hiddenAt) });
        note('hidden', 'add', fg.titleId, name, 'visible', 'hidden');
      } else sections.hidden.unchanged++;
    }
    // порядок очереди
    if (fg.roadmapPosition !== null) {
      if (!g) skip('roadmapOrder');
      else {
        fileOrder.set(g.id, fg.roadmapPosition);
        const cur = orderBy.get(g.id);
        if (cur === undefined) {
          ops.push({ t: 'order', gameId: g.id, position: fg.roadmapPosition });
          note('roadmapOrder', 'add', fg.titleId, name, null, String(fg.roadmapPosition));
        } else if (cur !== fg.roadmapPosition) {
          ops.push({ t: 'order', gameId: g.id, position: fg.roadmapPosition });
          note('roadmapOrder', 'change', fg.titleId, name, String(cur), String(fg.roadmapPosition));
        } else sections.roadmapOrder.unchanged++;
      }
    }
    // «убрано из плана»
    if (fg.roadmapExcluded) {
      if (!g) skip('roadmapExcluded');
      else if (!excludedSet.has(g.id)) {
        ops.push({ t: 'excluded', gameId: g.id });
        note('roadmapExcluded', 'add', fg.titleId, name, null, 'excluded');
      } else sections.roadmapExcluded.unchanged++;
    }
    // исключения месяцев
    for (const month of fg.monthExclusions) {
      if (!g) skip('monthExclusions');
      else if (!monthSet.has(`${g.id}|${month}`)) {
        monthSet.add(`${g.id}|${month}`); // дубль внутри файла не считаем повторно (N-5)
        ops.push({ t: 'month', gameId: g.id, month });
        note('monthExclusions', 'add', fg.titleId, name, null, month);
      } else sections.monthExclusions.unchanged++;
    }
  }

  // планируемые игры: по externalSource+externalId, иначе по названию и дате
  const byExt = new Map(planned.filter((p) => p.externalSource && p.externalId).map((p) => [`${p.externalSource}|${p.externalId}`, p]));
  const byKey = new Map(planned.map((p) => [pk(p), p]));
  const seenNew = new Set<string>(); // ключи уже запланированных к созданию (дубли в файле, N-5)
  const seenUpd = new Set<number>();
  for (const fp of file.plannedGames) {
    const extKey = fp.externalSource && fp.externalId ? `${fp.externalSource}|${fp.externalId}` : null;
    const cur = (extKey ? byExt.get(extKey) : undefined) ?? byKey.get(pk(fp));
    if (!cur) {
      if ((extKey && seenNew.has(`e:${extKey}`)) || seenNew.has(`k:${pk(fp)}`)) {
        sections.plannedGames.unchanged++;
        continue;
      }
      if (extKey) seenNew.add(`e:${extKey}`);
      seenNew.add(`k:${pk(fp)}`);
      ops.push({ t: 'planned', id: null, values: plannedValues(fp, null) });
      note('plannedGames', 'add', null, fp.title, null, fp.title);
      continue;
    }
    if (seenUpd.has(cur.id)) {
      sections.plannedGames.unchanged++;
      continue;
    }
    seenUpd.add(cur.id);
    const merged = plannedValues(fp, cur);
    const same =
      merged.title === cur.title && merged.releaseDate === cur.releaseDate && merged.coverUrl === cur.coverUrl && merged.wantAtRelease === cur.wantAtRelease &&
      merged.hoursManual === cur.hoursManual && merged.externalSource === cur.externalSource && merged.externalId === cur.externalId && merged.status === cur.status;
    if (same) sections.plannedGames.unchanged++;
    else {
      ops.push({ t: 'planned', id: cur.id, values: merged });
      note('plannedGames', 'change', null, fp.title, cur.title, fp.title);
    }
  }

  normalizeOrder(ops, orderBy, fileOrder);

  // настройки плана
  if (file.roadmapSettings) {
    const cur = settings[0];
    const fs = file.roadmapSettings;
    if (!cur) {
      ops.push({ t: 'settings', year: fs.year, hoursPerWeek: fs.hoursPerWeek });
      note('roadmapSettings', 'add', null, 'Настройки плана', null, `${fs.year}, ${fs.hoursPerWeek} ч/нед`);
    } else if (cur.year !== fs.year || Math.abs(cur.hoursPerWeek - fs.hoursPerWeek) > 1e-9) {
      ops.push({ t: 'settings', year: fs.year, hoursPerWeek: fs.hoursPerWeek });
      note('roadmapSettings', 'change', null, 'Настройки плана', `${cur.year}, ${cur.hoursPerWeek} ч/нед`, `${fs.year}, ${fs.hoursPerWeek} ч/нед`);
    } else sections.roadmapSettings.unchanged++;
  }

  // в списке изменений статусы первыми
  const rank = (c: RestoreChange) => (c.section === 'status' ? 0 : 1);
  const sorted = changes.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
  return {
    ops,
    report: {
      sections,
      changes: sorted.slice(0, CHANGES_LIMIT),
      changesTruncated: sorted.length > CHANGES_LIMIT,
      missing: [...missing].slice(0, MISSING_LIMIT).map(([titleId, name]) => ({ titleId, name })),
    },
  };
}

/**
 * Позиции очереди должны оставаться уникальными (N-2). Игры из файла сохраняют позиции файла; игры вне файла, чья позиция совпала
 * с позицией игры из файла, уходят после последней позиции файла с сохранением относительного порядка. Работает только если есть изменения порядка;
 * повторный apply ничего не меняет (после сдвига совпадений нет).
 */
function normalizeOrder(ops: Op[], orderBy: Map<number, number>, filePos: Map<number, number>): void {
  if (!ops.some((o) => o.t === 'order')) return;
  const taken = new Set(filePos.values());
  const outside = [...orderBy].filter(([id]) => !filePos.has(id)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!outside.some(([, pos]) => taken.has(pos))) return;
  let next = Math.max(...taken) + 1;
  for (const [gameId] of outside) ops.push({ t: 'order', gameId, position: next++ });
}

export type RestoreResult = RestoreReport & { applied: boolean; backupId: number | null };

export async function previewRestore(db: AnyDb, file: BackupFile): Promise<RestoreResult> {
  const plan = await planRestore(db, file);
  return { ...plan.report, applied: false, backupId: null };
}

/** Применяет план в одной транзакции. План строится заново внутри транзакции (под блокировкой), чтобы совпасть с БД. */
export async function applyRestore(db: AnyDb, file: BackupFile, now: Date = new Date()): Promise<RestoreResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('backup_restore'))`);
    const plan = await planRestore(tx, file);
    const hasStatus = plan.ops.some((o) => o.t === 'status');
    const backupId = hasStatus ? await snapshotAllStatuses(tx, 'before_file_restore', now) : null;

    for (const op of plan.ops) {
      switch (op.t) {
        case 'status':
          await tx
            .insert(gameStatus)
            .values({ gameId: op.gameId, status: op.value, completedAt: op.completedAt, droppedAt: op.droppedAt, statusChangedAt: op.statusChangedAt, updatedAt: now })
            .onConflictDoUpdate({
              target: gameStatus.gameId,
              set: { status: op.value, completedAt: op.completedAt, droppedAt: op.droppedAt, statusChangedAt: op.statusChangedAt, updatedAt: now },
            });
          break;
        case 'duration':
          await tx.update(games).set({ durationOverrideHours: op.hours }).where(eq(games.id, op.gameId));
          break;
        case 'genres':
          await tx.update(games).set({ genresOverride: op.genres }).where(eq(games.id, op.gameId));
          break;
        case 'hidden':
          await tx.update(games).set({ hiddenAt: op.at }).where(eq(games.id, op.gameId));
          break;
        case 'order':
          await tx
            .insert(roadmapOrder)
            .values({ gameId: op.gameId, position: op.position, updatedAt: now })
            .onConflictDoUpdate({ target: roadmapOrder.gameId, set: { position: op.position, updatedAt: now } });
          break;
        case 'excluded':
          await tx.insert(roadmapExcluded).values({ gameId: op.gameId }).onConflictDoNothing();
          break;
        case 'month':
          await tx.insert(gameMonthExclusions).values({ gameId: op.gameId, month: op.month }).onConflictDoNothing();
          break;
        case 'planned':
          if (op.id === null) await tx.insert(plannedGames).values(op.values);
          else await tx.update(plannedGames).set({ ...op.values, updatedAt: now }).where(eq(plannedGames.id, op.id));
          break;
        case 'settings':
          await tx
            .insert(roadmapSettings)
            .values({ id: 1, year: op.year, hoursPerWeek: op.hoursPerWeek, updatedAt: now })
            .onConflictDoUpdate({ target: roadmapSettings.id, set: { year: op.year, hoursPerWeek: op.hoursPerWeek, updatedAt: now } });
          break;
      }
    }
    return { ...plan.report, applied: true, backupId };
  });
}
