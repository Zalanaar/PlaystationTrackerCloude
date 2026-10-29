// Нормализация названий и выбор лучшего совпадения HLTB. Чистые функции, без сети и БД (контракт 16.6).

export type HltbCandidate = {
  id: number;
  name: string;
  /** часы (0.1) или null, если у HLTB нет времени */
  mainHours: number | null;
  extraHours: number | null;
};

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

/** Хвосты изданий и платформ, которых нет в названии на HLTB. Вырезаются целиком. */
const NOISE = [
  /\b(game of the year|goty|definitive|complete|ultimate|deluxe|digital deluxe|standard|gold|premium|legendary|special|collector'?s|anniversary|director'?s cut|enhanced|remastered|remaster|hd)\s+edition\b/g,
  /\b(game of the year|goty|definitive|complete|ultimate|deluxe|digital deluxe|premium|legendary|special|director'?s cut|enhanced)\b/g,
  /\bedition\b/g,
  /\b(remastered|remaster|hd remaster)\b/g,
  /\b(ps4|ps5|playstation ?[45]?|ps vita|pc)\b(\s*(version|edition))?/g,
  /\bfor playstation ?[45]\b/g,
  /\b(bundle|collection)\b(?=\s*$)/g,
];

/** Название -> строка для сравнения: нижний регистр, без диакритики и знаков, римские цифры -> арабские, без хвостов изданий. */
export function normalizeTitle(raw: string, o: { keepRoman?: boolean } = {}): string {
  let s = raw.replace(/[™®©℠]/g, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/&/g, ' and ').replace(/[’‘ʼ]/g, "'");
  s = s.replace(/[^a-z0-9а-яё' ]+/g, ' ');
  for (const re of NOISE) s = s.replace(re, ' ');
  s = s.replace(/'/g, '');
  const words = s.split(/\s+/).filter(Boolean).map((w, i) => (!o.keepRoman && i > 0 && ROMAN[w] ? ROMAN[w] : w));
  return words.join(' ');
}

function bigrams(s: string): Map<string, number> {
  const t = ` ${s} `;
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Коэффициент Дайса по биграммам, 0..1. Пустые строки = 0. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return total ? (2 * hit) / total : 0;
}

const numbers = (s: string): string[] => s.split(' ').filter((w) => /^\d+$/.test(w)).sort();

/** Схожесть двух названий 0..1. Разные номера частей («4» против «2») сильно штрафуются. */
export function similarity(psnName: string, hltbName: string): number {
  const a = normalizeTitle(psnName);
  const b = normalizeTitle(hltbName);
  let score = dice(a, b);
  if (numbers(a).join(',') !== numbers(b).join(',')) score -= 0.3;
  return Math.max(0, score);
}

export const MATCH_THRESHOLD = 0.8;

/**
 * Лучшее совпадение или null. Порядок кандидатов = порядок выдачи HLTB: при равной схожести выигрывает ранний.
 * Ниже порога = нет совпадения («не найдено»), чтобы не привязать чужую игру.
 */
export function pickBest(psnName: string, candidates: readonly HltbCandidate[]): HltbCandidate | null {
  let best: HltbCandidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = similarity(psnName, c.name);
    if (s > bestScore + 1e-9) {
      best = c;
      bestScore = s;
    }
  }
  return best && bestScore >= MATCH_THRESHOLD ? best : null;
}

/** Слова для запроса к HLTB: нормализованное название без хвостов изданий. */
export function searchTerm(psnName: string): string {
  return normalizeTitle(psnName) || psnName.trim();
}

/** Секунды HLTB -> часы с точностью 0.1. 0 или мусор = null. */
export function secondsToHours(sec: unknown): number | null {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.round(sec / 360) / 10;
  return h > 0 ? h : null;
}

/** Максимум запросов к HLTB на одну игру (16.6). */
export const MAX_QUERIES_PER_GAME = 3;

/**
 * Запросы к HLTB по порядку: 1) с исходными римскими цифрами («diablo ii resurrected»: HLTB ищет по словам, «2» вместо «II» может не находить),
 * 2) с арабскими, 3) укороченный (до ':' / ' - ' в исходном названии, иначе без последнего слова). Без повторов, не больше MAX_QUERIES_PER_GAME.
 */
export function searchTerms(psnName: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const v = t.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  add(normalizeTitle(psnName, { keepRoman: true }));
  add(searchTerm(psnName));
  const head = psnName.split(/\s*[:\u2013\u2014]\s*|\s+-\s+/)[0] ?? '';
  const byHead = normalizeTitle(head, { keepRoman: true });
  if (head !== psnName && byHead) add(byHead);
  else {
    const w = normalizeTitle(psnName, { keepRoman: true }).split(' ');
    if (w.length >= 2) add(w.slice(0, -1).join(' '));
  }
  return out.slice(0, MAX_QUERIES_PER_GAME);
}

/** Хвосты-пометки, которые PSN добавляет к названию, а HLTB нет («Gothic Classic» = «Gothic»). Только они отбрасываются при мягком сравнении. */
const LOOSE_TAIL = new Set(['classic', 'original']);

/**
 * Мягкое совпадение (вторая очередь, когда pickBest ничего не дал): имя кандидата должно ТОЧНО совпасть с нашим названием
 * без хвостовых слов из LOOSE_TAIL. Номера частей совпадают автоматически (равенство строк), поэтому «Gothic II» не привязывается к «Gothic»,
 * а «Diablo III» к «Diablo II». Произвольные подзаголовки не отбрасываем: «Batman: Arkham Knight» не станет «Batman».
 */
export function pickLoose(psnName: string, candidates: readonly HltbCandidate[]): HltbCandidate | null {
  const words = normalizeTitle(psnName).split(' ').filter(Boolean);
  let n = words.length;
  while (n > 1 && LOOSE_TAIL.has(words[n - 1])) n--;
  if (n === words.length) return null;
  const base = words.slice(0, n).join(' ');
  return candidates.find((c) => normalizeTitle(c.name) === base) ?? null;
}

export function pickAny(psnName: string, candidates: readonly HltbCandidate[]): HltbCandidate | null {
  return pickBest(psnName, candidates) ?? pickLoose(psnName, candidates);
}
