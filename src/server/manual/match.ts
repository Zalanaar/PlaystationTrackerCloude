// Фаза 43 (контракт 43.5): сопоставление записи «не куплено» (RAWG) с игрой библиотеки PSN. Чистая часть, без БД.
// Автоснятие пометки только при УВЕРЕННОМ совпадении и наличии запуска/часов; слабое совпадение = вопрос «Это та игра?».
import { libraryKey } from '@/server/recommend/discover-rank';

export type LibraryRow = {
  id: number;
  name: string;
  imageUrl: string | null;
  duplicateOfGameId: number | null;
  hiddenAt: Date | null;
  lastPlayedAt: Date | null;
  playDurationSeconds: number;
};

/** Группа = главная игра + её дубли (Фаза 23). Факты запуска — по всей группе. */
export type LibraryGroup = {
  primaryId: number;
  name: string;
  imageUrl: string | null;
  memberIds: number[];
  keys: string[];
  launched: boolean;
  lastPlayedAt: number;
};

export function buildGroups(rows: readonly LibraryRow[]): LibraryGroup[] {
  const visible = rows.filter((r) => r.hiddenAt === null);
  const byId = new Map(visible.map((r) => [r.id, r]));
  const groups = new Map<number, LibraryGroup>();
  for (const r of visible) {
    const pid = r.duplicateOfGameId !== null && byId.has(r.duplicateOfGameId) ? r.duplicateOfGameId : r.id;
    const primary = byId.get(pid);
    if (!primary) continue;
    let g = groups.get(pid);
    if (!g) {
      g = { primaryId: pid, name: primary.name, imageUrl: primary.imageUrl, memberIds: [], keys: [], launched: false, lastPlayedAt: 0 };
      groups.set(pid, g);
    }
    g.memberIds.push(r.id);
    const k = libraryKey(r.name);
    if (k && !g.keys.includes(k)) g.keys.push(k);
    if (r.lastPlayedAt !== null || r.playDurationSeconds > 0) g.launched = true;
    if (r.lastPlayedAt !== null) g.lastPlayedAt = Math.max(g.lastPlayedAt, r.lastPlayedAt.getTime());
  }
  return [...groups.values()].sort((a, b) => a.primaryId - b.primaryId);
}

export type MatchDecision = { kind: 'confident'; groupId: number } | { kind: 'suggest'; groupId: number } | { kind: 'none' };

const bestOf = (gs: readonly LibraryGroup[]): LibraryGroup => [...gs].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || a.primaryId - b.primaryId)[0];

/** shorter целиком входит в longer как непрерывная цепочка слов («hades» в «hades 2», «god of war» в «god of war ragnarok»). */
export function tokensContained(shorter: string, longer: string): boolean {
  const a = shorter.split(' ');
  const b = longer.split(' ');
  if (a.length >= b.length || shorter.length < 4) return false;
  for (let i = 0; i + a.length <= b.length; i++) if (a.every((w, j) => b[i + j] === w)) return true;
  return false;
}

/**
 * coveredGameId: игра библиотеки из owned_marks (covered) для этого RAWG id.
 * rejected: id игр библиотеки, на которые пользователь ответил «нет» (пара больше не предлагается и не склеивается автоматом).
 */
export function decideMatch(rec: { title: string }, groups: readonly LibraryGroup[], coveredGameId: number | null, rejected: readonly number[]): MatchDecision {
  const rej = new Set(rejected);
  const usable = groups.filter((g) => g.launched && !g.memberIds.some((m) => rej.has(m)));
  if (coveredGameId !== null) {
    const g = groups.find((x) => x.memberIds.includes(coveredGameId));
    if (g) return g.launched && !g.memberIds.some((m) => rej.has(m)) ? { kind: 'confident', groupId: g.primaryId } : { kind: 'none' };
  }
  const key = libraryKey(rec.title);
  if (!key) return { kind: 'none' };
  const exact = usable.filter((g) => g.keys.includes(key));
  if (exact.length === 1) return { kind: 'confident', groupId: exact[0].primaryId };
  if (exact.length > 1) return { kind: 'suggest', groupId: bestOf(exact).primaryId };
  // точная пара есть в библиотеке (даже без запуска или отклонённая): слабые совпадения с другими играми не предлагаем
  if (groups.some((g) => g.keys.includes(key))) return { kind: 'none' };
  const weak = usable.filter((g) => g.keys.some((k) => tokensContained(key, k) || tokensContained(k, key)));
  if (weak.length > 0) return { kind: 'suggest', groupId: bestOf(weak).primaryId };
  return { kind: 'none' };
}
