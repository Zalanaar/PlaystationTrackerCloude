// Шаг синка «не куплено» (Фаза 43, контракт 43.5): сопоставляет записи manual_games с играми библиотеки. Без сети.
// Идемпотентен: повторный запуск ничего не меняет. Батчи по BATCH записей, между батчами проверяется бюджет времени.
// Уверенное совпадение + запуск/часы -> запись склеивается (пометка снята, статус backlog перенесён). Слабое -> suggested_game_id (вопрос во «Входящих»).
// Пакет 5: записи «с другой платформы» сами не склеиваются никогда: любое совпадение = вопрос «Это та игра?» (куплена ли игра на PS, решает пользователь).
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema } from '@/db';
import { buildGroups, decideMatch } from '@/server/manual/match';
import { linkToGame } from '@/server/manual/store';
import type { RunContext } from './context';

const { manualGames: m, games: g, ownedMarks: om } = schema;

export const MANUAL_MATCH_BATCH = 50;
const MIN_LEFT_MS = 3000;

export type ManualMatchDeps = Record<string, never>;
export const defaultManualMatchDeps: ManualMatchDeps = {};

export type ManualMatchResult = { checked: number; linked: number; suggested: number };

export async function manualMatchStep(ctx: RunContext, deps: ManualMatchDeps = {}): Promise<ManualMatchResult> {
  void deps; // зарезервировано под настройки шага
  const { db, userId } = ctx;
  const res: ManualMatchResult = { checked: 0, linked: 0, suggested: 0 };
  const recs = await db
    .select()
    .from(m)
    .where(and(eq(m.userId, userId), inArray(m.kind, ['ps_backlog', 'other_platform']), isNull(m.linkedGameId)))
    .orderBy(m.id);
  if (recs.length === 0) return res;
  const rows = await db
    .select({ id: g.id, name: g.name, imageUrl: g.imageUrl, duplicateOfGameId: g.duplicateOfGameId, hiddenAt: g.hiddenAt, lastPlayedAt: g.lastPlayedAt, playDurationSeconds: g.playDurationSeconds })
    .from(g)
    .where(eq(g.userId, userId));
  const groups = buildGroups(rows);
  const marks = await db.select({ rawgId: om.rawgId, gameId: om.coveredByGameId }).from(om).where(eq(om.userId, userId));
  const covered = new Map(marks.flatMap((x) => (x.gameId === null ? [] : [[x.rawgId, x.gameId] as const])));

  for (let i = 0; i < recs.length; i += MANUAL_MATCH_BATCH) {
    if (i > 0 && ctx.timeLeft() < MIN_LEFT_MS) {
      ctx.warn('manual_match_partial', 'Бэклог «не куплено»: сопоставление не успело на всех записях, продолжится в следующем синке.');
      break;
    }
    for (const r of recs.slice(i, i + MANUAL_MATCH_BATCH)) {
      res.checked++;
      const raw = decideMatch(r, groups, covered.get(r.rawgId) ?? null, r.rejectedGameIds);
      const d = raw.kind === 'confident' && r.kind === 'other_platform' ? { kind: 'suggest' as const, groupId: raw.groupId } : raw;
      if (d.kind === 'confident') {
        if (await linkToGame(db, userId, r.id, d.groupId, ctx.now())) res.linked++;
      } else {
        const next = d.kind === 'suggest' ? d.groupId : null;
        if (next !== r.suggestedGameId) {
          await db.update(m).set({ suggestedGameId: next, updatedAt: ctx.now() }).where(and(eq(m.userId, userId), eq(m.id, r.id), isNull(m.linkedGameId)));
        }
        if (next !== null) res.suggested++;
      }
    }
  }
  return res;
}
