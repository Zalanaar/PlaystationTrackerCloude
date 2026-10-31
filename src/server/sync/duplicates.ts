// Дубли игр (контракт 25.2): та же игра на разных платформах склеивается в одну карточку.
// planDuplicates чистая (тестируется без БД), applyDuplicates пишет только изменившиеся строки одного пользователя.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';

const { games } = schema;

export type DupGame = {
  id: number;
  conceptId: string | null;
  name: string;
  category: string;
  playSeconds: number;
  hidden: boolean;
  notDuplicate: boolean;
  /** текущее значение games.duplicate_of_game_id */
  duplicateOf: number | null;
};

/** Нормализованное имя: без ™®©, текста в скобках, меток платформы и знаков препинания. */
export function normalizeGameName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\bplaystation\s*[45]\b/g, ' ')
    .replace(/\bps\s*[45]\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Новое значение duplicate_of_game_id для каждой игры (только те, что нужно изменить). */
export function planDuplicates(rows: readonly DupGame[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const eligible = rows.filter((g) => !g.hidden && !g.notDuplicate);
  for (const g of rows) if ((g.hidden || g.notDuplicate) && g.duplicateOf !== null) out.set(g.id, null);

  // группы по concept_id; игра без concept_id присоединяется к группе с тем же именем, иначе группируется по имени
  const groups = new Map<string, DupGame[]>();
  const nameToConceptKey = new Map<string, string>();
  for (const g of eligible) {
    if (g.conceptId === null) continue;
    const key = `c:${g.conceptId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(g);
    const n = normalizeGameName(g.name);
    if (n && !nameToConceptKey.has(n)) nameToConceptKey.set(n, key);
  }
  for (const g of eligible) {
    if (g.conceptId !== null) continue;
    const n = normalizeGameName(g.name);
    if (!n) continue;
    const key = nameToConceptKey.get(n) ?? `n:${n}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(g);
  }

  const currentPrimaries = new Set(rows.flatMap((g) => (g.duplicateOf !== null ? [g.duplicateOf] : [])));
  for (const members of groups.values()) {
    const sorted = [...members].sort(
      (a, b) =>
        b.playSeconds - a.playSeconds ||
        Number(currentPrimaries.has(b.id)) - Number(currentPrimaries.has(a.id)) ||
        Number(b.category === 'ps5_native_game') - Number(a.category === 'ps5_native_game') ||
        a.id - b.id,
    );
    const primary = members.length > 1 ? sorted[0] : null;
    for (const g of members) {
      const want = primary && g.id !== primary.id ? primary.id : null;
      if (g.duplicateOf !== want) out.set(g.id, want);
    }
  }
  return out;
}

/** Пересчёт пометок пользователя. Возвращает число изменённых игр. not_duplicate и hidden_at не меняются. */
export async function applyDuplicates(db: AnyDb, userId: UserId): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: games.id,
        conceptId: games.conceptId,
        name: games.name,
        category: games.category,
        playSeconds: games.playDurationSeconds,
        hiddenAt: games.hiddenAt,
        notDuplicate: games.notDuplicate,
        duplicateOf: games.duplicateOfGameId,
      })
      .from(games)
      .where(eq(games.userId, userId));
    const plan = planDuplicates(rows.map((r) => ({ ...r, hidden: r.hiddenAt !== null })));
    if (plan.size === 0) return 0;
    // сначала снимаем ссылки (главная не должна оказаться чьим-то дублем в момент записи), затем ставим новые
    const clear = [...plan].filter(([, v]) => v === null).map(([id]) => id);
    if (clear.length) await tx.update(games).set({ duplicateOfGameId: null }).where(and(eq(games.userId, userId), inArray(games.id, clear)));
    const byPrimary = new Map<number, number[]>();
    for (const [id, v] of plan) if (v !== null) (byPrimary.get(v) ?? byPrimary.set(v, []).get(v)!).push(id);
    for (const [primary, ids] of byPrimary) {
      await tx.update(games).set({ duplicateOfGameId: primary }).where(and(eq(games.userId, userId), inArray(games.id, ids)));
    }
    // у новой главной нет статуса, а у версии группы есть: копируем самый свежий
    const primaries = [...new Set([...byPrimary.keys()])];
    if (primaries.length) {
      await tx.execute(sql`
        insert into game_status (game_id, user_id, status, completed_at, dropped_at, status_changed_at)
        select distinct on (p.id) p.id, p.user_id, s.status, s.completed_at, s.dropped_at, s.status_changed_at
        from games p
        join games d on d.user_id = p.user_id and d.duplicate_of_game_id = p.id
        join game_status s on s.game_id = d.id and s.user_id = p.user_id
        where p.user_id = ${userId} and p.id in (${sql.join(primaries.map((i) => sql`${i}`), sql`, `)})
          and not exists (select 1 from game_status x where x.game_id = p.id)
        order by p.id, s.status_changed_at desc
        on conflict (game_id) do nothing`);
    }
    return plan.size;
  });
}

