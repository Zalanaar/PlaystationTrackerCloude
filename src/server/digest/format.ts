// Сборка текста сводки (docs/design/spec-phase-29-digest.md, контракт F29.5). Чистые функции: без env, БД и сети.
// Plain text без parse_mode. Ссылки строит вызывающий через gameLink; здесь только вставка.

export const DIGEST_HARD_LIMIT = 3500;
export const ADVICE_REASON_MAX = 160;
export const LINKED_GAMES_MAX = 3;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Склонение по числу: one (1, 21), few (2-4, 22-24), many (0, 5-20, 25-30...). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export const gamesWord = (n: number) => plural(n, 'игра', 'игры', 'игр');
export const trophiesWord = (n: number) => plural(n, 'трофей', 'трофея', 'трофеев');
export const platinumsWord = (n: number) => plural(n, 'платина', 'платины', 'платин');
export const hintsWord = (n: number) => plural(n, 'подсказка', 'подсказки', 'подсказок');

/** «12 ч 30 м», «40 м», «3 ч», 0 -> «0 ч». Секунды отбрасываются (округление до минуты). */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0 && m === 0) return '0 ч';
  if (h === 0) return `${m} м`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} м`;
}

const parts = (date: string) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) });

/** «20–26 окт» или «27 окт–2 ноя». */
export function weekLabel(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  return a.m === b.m && a.y === b.y ? `${a.d}–${b.d} ${MONTHS[b.m - 1]}` : `${a.d} ${MONTHS[a.m - 1]}–${b.d} ${MONTHS[b.m - 1]}`;
}

/** Срок игры внутри недели: «пн–ср» или «чт». from/to внутри одной недели пн..вс (YYYY-MM-DD). */
export function dayRangeLabel(from: string, to: string): string {
  const dow = (date: string) => {
    const { y, m, d } = parts(date);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  };
  const a = dow(from);
  const b = dow(to);
  return a === b ? WEEKDAYS[a] : `${WEEKDAYS[a]}–${WEEKDAYS[b]}`;
}

export type DigestHours = {
  /** Секунды недели; null = нет данных (нет снимков). */
  weekSeconds: number | null;
  /** Секунды прошлой недели; null = нет данных (нет истории за неё). */
  prevWeekSeconds: number | null;
  /** Истории часов нет вообще. */
  noHistory: boolean;
};
export type DigestGameRef = { gameId: number | null; title: string };
export type DigestTrophies = { total: number; platinums: number; platinumGames: DigestGameRef[] };
export type DigestPlan = {
  /** null = состояние неизвестно (нет данных / не начат). */
  state: 'ahead' | 'behind' | 'onTrack' | null;
  diffSeconds: number;
  next: (DigestGameRef & { days: string })[];
};
export type DigestAdvice = { gameId: number; title: string; reason: string };

/** Блок = null: не собран (сбой) или нечего показать; пропускается молча. */
export type DigestData = {
  weekFrom: string;
  weekTo: string;
  hours: DigestHours | null;
  trophies: DigestTrophies | null;
  plan: DigestPlan | null;
  advice: DigestAdvice | null;
  /** checkCount + unsorted. */
  statuses: number | null;
};

export type FormatOpts = {
  /** Абсолютный origin без завершающего слеша или null. */
  origin: string | null;
  /** Ссылка на игру или null; по умолчанию `{origin}/?game=<id>`. */
  link?: (gameId: number | null) => string | null;
};

const MINUTE_15 = 15 * 60;

function hoursLines(h: DigestHours | null): string[] | null {
  if (!h || h.weekSeconds === null) return null;
  const week = h.weekSeconds;
  const prev = h.prevWeekSeconds;
  if (prev === null) {
    if (week <= 0) return null;
    const tail = h.noHistory ? ' Для сравнения нет данных: история часов начинается с первого синка.' : ' Для сравнения нет данных за прошлую неделю.';
    return [`Сыграно ${formatDuration(week)} за неделю.${tail}`];
  }
  if (week <= 0 && prev <= 0) return null;
  if (week <= 0) return [`За неделю часов нет, на прошлой было ${formatDuration(prev)}.`];
  const diff = week - prev;
  if (Math.abs(diff) < MINUTE_15) return [`Сыграно ${formatDuration(week)} за неделю, как на прошлой.`];
  return [`Сыграно ${formatDuration(week)} за неделю, на ${formatDuration(Math.abs(diff))} ${diff > 0 ? 'больше' : 'меньше'} прошлой.`];
}

function trophyLines(t: DigestTrophies | null, link: NonNullable<FormatOpts['link']>): string[] | null {
  if (!t || t.total <= 0) return null;
  const lines = [`+${t.total} ${trophiesWord(t.total)}${t.platinums > 0 ? `, платин: ${t.platinums}` : ''}.`];
  for (const g of t.platinumGames.slice(0, LINKED_GAMES_MAX)) {
    lines.push(`Платина: ${g.title}`);
    const l = link(g.gameId);
    if (l) lines.push(l);
  }
  return lines;
}

function planLines(p: DigestPlan | null, link: NonNullable<FormatOpts['link']>): string[] | null {
  if (!p) return null;
  const lines: string[] = [];
  if (p.state === 'behind') lines.push(`Отстаёшь от графика на ${formatDuration(Math.abs(p.diffSeconds))}.`);
  else if (p.state === 'ahead') lines.push(`Опережаешь график на ${formatDuration(Math.abs(p.diffSeconds))}.`);
  else if (p.state === 'onTrack') lines.push('Идёшь по графику.');
  if (p.next.length === 0) lines.push('На следующую неделю игр в Плане нет.');
  else {
    lines.push('На следующую неделю:');
    for (const g of p.next.slice(0, LINKED_GAMES_MAX)) {
      lines.push(`- ${g.title}, ${g.days}`);
      const l = link(g.gameId);
      if (l) lines.push(l);
    }
  }
  return lines;
}

/** Причина до 160 символов с «…». */
export function clipReason(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= ADVICE_REASON_MAX ? s : `${s.slice(0, ADVICE_REASON_MAX - 1).trimEnd()}…`;
}

function adviceLines(a: DigestAdvice | null, link: NonNullable<FormatOpts['link']>): string[] | null {
  if (!a) return null;
  const lines = [a.title];
  const reason = clipReason(a.reason);
  if (reason) lines.push(reason);
  const l = link(a.gameId);
  if (l) lines.push(l);
  return lines;
}

/** Готовый текст сообщения (spec 1, 2, 6). Не бросает. */
export function formatDigest(data: DigestData, opts: FormatOpts): string {
  const origin = opts.origin ? opts.origin.replace(/\/+$/, '') : null;
  const link = opts.link ?? ((id: number | null) => (origin && id !== null && Number.isSafeInteger(id) && id > 0 ? `${origin}/?game=${id}` : null));
  const label = weekLabel(data.weekFrom, data.weekTo);
  const open = origin ? `Открыть: ${origin}/` : null;

  const hours = hoursLines(data.hours);
  const trophies = trophyLines(data.trophies, link);
  const plan = planLines(data.plan, link);
  const advice = adviceLines(data.advice, link);
  const statuses = data.statuses !== null && data.statuses > 0 ? [`Подсказок по статусам: ${data.statuses}.${origin ? ` Разобрать: ${origin}/triage?mode=check` : ''}`] : null;

  if (!hours && !trophies && !plan && !advice && !statuses) {
    return [`PS Tracker: за неделю ${label} игр и трофеев не было. Хорошей недели.`, open].filter((x): x is string => x !== null).join('\n');
  }

  const blocks: string[][] = [[`PS Tracker: итоги недели, ${label}`]];
  if (!hours && !trophies) blocks.push(['За неделю игр и трофеев не было.']);
  const titled: [string, string[] | null][] = [['Часы', hours], ['Трофеи', trophies], ['План', plan], ['Совет', advice], ['Статусы', statuses]];
  for (const [title, lines] of titled) if (lines) blocks.push([title, ...lines]);
  if (open) blocks.push([open]);
  return clampLength(blocks.map((b) => b.join('\n')));
}

/** Жёсткий предел: целые блоки с конца отбрасываются, пока не уложимся (первый блок — заголовок — остаётся). */
function clampLength(blocks: string[]): string {
  const out = [...blocks];
  let text = out.join('\n\n');
  while (text.length > DIGEST_HARD_LIMIT && out.length > 1) {
    out.pop();
    text = out.join('\n\n');
  }
  return text.length > DIGEST_HARD_LIMIT ? text.slice(0, DIGEST_HARD_LIMIT) : text;
}
