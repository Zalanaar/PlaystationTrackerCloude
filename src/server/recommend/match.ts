// Чистые функции режима «Новое от ИИ» (контракт 19.4): разбор ответа модели и сверка названия с каталогом.
// Без env, БД и сети. Модели не доверяем: на экран попадает только то, что подтвердил RAWG.
import { LINK_RE } from './phrase';

export const MAX_PROPOSALS = 15;
export const TITLE_MAX = 120;
export const REASON_MAX = 200;
export const SIMILARITY_THRESHOLD = 0.9;
export const YEAR_TOLERANCE = 1;

export type Proposal = { title: string; year: number | null; reason: string };

/**
 * Нормализация названия: регистр, диакритика, «ё»=«е», знаки (™®©, апострофы, пунктуация), ведущий артикль the/a/an.
 * Римские и арабские цифры друг в друга НЕ переводятся («Hades II» и «Hades 2» разные строки).
 */
export function normalizeTitle(s: string): string {
  const t = s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[™®©'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return t.replace(/^(?:the|a|an)\s+/, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Сходство 0..1 = 1 − расстояние Левенштейна / длина длинной строки (по нормализованным строкам). */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na && !nb) return 0;
  const max = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / max;
}

const ROMAN = /^(?:ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)$/;
/** Токены-номера (цифры и римские) как отсортированная строка: «Resident Evil 2» не должно совпасть с «Resident Evil 3» по сходству 0.93. */
function numberTokens(norm: string): string {
  return norm
    .split(' ')
    .filter((t) => /^\d+$/.test(t) || ROMAN.test(t))
    .sort()
    .join(',');
}

/** Названия считаются одной игрой: равны после нормализации ИЛИ сходство ≥ 0.9 при совпадающих номерах частей. */
export function titleMatches(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (numberTokens(na) !== numberTokens(nb)) return false;
  return similarity(a, b) >= SIMILARITY_THRESHOLD;
}

/** Год модели против даты RAWG: если известны оба, расхождение не больше 1 года. */
export function yearMatches(year: number | null, releaseDate: string | null): boolean {
  if (year === null || !releaseDate) return true;
  const y = Number(releaseDate.slice(0, 4));
  return Number.isFinite(y) && Math.abs(y - year) <= YEAR_TOLERANCE;
}

export type MatchableResult = { title: string; releaseDate: string | null; playstation: boolean };

/** Первый результат каталога, подходящий по платформе, названию и году; иначе null (кандидат отбрасывается). */
export function pickMatch<T extends MatchableResult>(proposal: Pick<Proposal, 'title' | 'year'>, results: readonly T[]): T | null {
  for (const r of results) {
    if (r.playstation && titleMatches(proposal.title, r.title) && yearMatches(proposal.year, r.releaseDate)) return r;
  }
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function isValidProposalText(s: unknown, max: number): s is string {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= max && !LINK_RE.test(s);
}

/**
 * Разбор ответа модели `{ "games": [ { title, year, reason } ] }`. Нарушающие элементы (длина, ссылки, не объект, дубль названия)
 * отбрасываются, лишнее сверх 15 обрезается. Не JSON или нет массива games = null.
 */
export function parseProposals(raw: string): Proposal[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : isObj(data) ? data.games : null;
  if (!Array.isArray(list)) return null;
  const out: Proposal[] = [];
  const seen = new Set<string>();
  for (const el of list.slice(0, MAX_PROPOSALS)) {
    if (!isObj(el)) continue;
    if (!isValidProposalText(el.title, TITLE_MAX) || !isValidProposalText(el.reason, REASON_MAX)) continue;
    const key = normalizeTitle(el.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const y = el.year;
    out.push({ title: el.title.trim(), year: typeof y === 'number' && Number.isInteger(y) && y >= 1970 && y <= 2100 ? y : null, reason: el.reason.trim() });
  }
  return out;
}
