// Чистая логика экрана «План»: форматирование, склейка списков ответа по key, перестановка, раскладка полос, проверка форм.
// Только import type из server (контракт docs/api-contract.md §17).
import type {
  Conflict, NotFitEntry, PlanItem, PlanSegment, PlannedGameDto, Progress, QueueState, RoadmapEntry, RoadmapResponse,
} from '@/server/roadmap/types';
import { plural } from '../format';

// ---------- Числа и даты ----------
export const BUDGET_MIN = 0.5;
export const BUDGET_MAX = 100;
export const BUDGET_STEP = 0.5;
export const ROW_HOURS_MIN = 0.5;
export const ROW_HOURS_MAX = 999;

/** «12», «7,5»: как в бэклоге (от 10 ч без дробной части). */
export function hoursNum(h: number): string {
  const r = h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
  return String(r).replace('.', ',');
}
export const hoursLabel = (h: number): string => `${hoursNum(h)} ч`;

/** Поле часов: «12», «7,5», «7.5» -> число с округлением до 0,1; null при ошибке или выходе из min..max. */
export function parseHoursField(text: string, min: number, max: number): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t) * 10) / 10;
  return n >= min && n <= max ? n : null;
}
export const parseBudget = (text: string): number | null => parseHoursField(text, BUDGET_MIN, BUDGET_MAX);
export const parseRowHours = (text: string): number | null => parseHoursField(text, ROW_HOURS_MIN, ROW_HOURS_MAX);
export const hoursFieldValue = (h: number | null | undefined): string => (h === null || h === undefined ? '' : String(h));

const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_AXIS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

type Ymd = { y: number; m: number; d: number };
export function parseYmd(iso: string): Ymd | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!r) return null;
  const y = +r[1], m = +r[2], d = +r[3];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}
/** Календарные дни от 1970 (без часовых поясов). */
export function dayNumber(iso: string): number {
  const p = parseYmd(iso);
  return p ? Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000) : NaN;
}
export const isRealDate = (iso: string): boolean => parseYmd(iso) !== null;

/** «3 апр.» */
export function dayText(iso: string): string {
  const p = parseYmd(iso);
  return p ? `${p.d} ${MONTHS_SHORT[p.m - 1]}` : iso;
}
/** «3 апр. 2027» */
export function dayYearText(iso: string): string {
  const p = parseYmd(iso);
  return p ? `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}` : iso;
}
/** «3 апреля» (для aria-label). */
export function dayLong(iso: string): string {
  const p = parseYmd(iso);
  return p ? `${p.d} ${MONTHS_GEN[p.m - 1]}` : iso;
}
/** «3–17 мар.» в одном месяце, «28 февр. – 6 мар.» в разных, «3 мар.» для одного дня. */
export function rangeText(from: string, to: string): string {
  const a = parseYmd(from), b = parseYmd(to);
  if (!a || !b) return `${from} – ${to}`;
  if (from === to) return dayText(from);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_SHORT[b.m - 1]}`;
  return `${dayText(from)} – ${dayText(to)}`;
}
export const weeksText = (days: number): string => `${Math.max(1, Math.ceil(days / 7))} нед.`;
const weeksWord = (n: number) => `${n} ${plural(n, ['неделя', 'недели', 'недель'])}`;

export function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

/** Подсказка под формой настроек: бюджет до конца года или на весь год. */
export function budgetHint(year: number, hoursPerWeek: number | null, todayIso: string): string {
  const today = parseYmd(todayIso);
  const total = daysInYear(year);
  const current = today !== null && today.y === year;
  const days = current ? Math.max(0, dayNumber(`${year}-12-31`) - dayNumber(todayIso) + 1) : total;
  const weeks = current ? Math.ceil(days / 7) : Math.round(total / 7);
  const budget = hoursPerWeek === null ? null : (hoursPerWeek * days) / 7;
  const head = current ? `Осталось ${weeks} нед.` : `${weeks} нед.`;
  if (budget === null) return head;
  return current ? `${head} · бюджет до конца года ≈ ${hoursLabel(budget)}` : `${head} · бюджет на год ≈ ${hoursLabel(budget)}`;
}

export function yearOptions(todayIso: string): { min: number; max: number } {
  const y = parseYmd(todayIso)?.y ?? new Date().getFullYear();
  return { min: y - 3, max: y + 1 };
}

// ---------- Дни и полосы ----------
/** Диапазон плана: from/to включительно, days = число дней. */
export type DayRange = { from: string; to: string; days: number };

/** Номер дня от начала диапазона (0-based); до начала отрицательный, после конца больше days-1. */
export function dayIndex(rangeFrom: string, iso: string): number {
  return dayNumber(iso) - dayNumber(rangeFrom);
}

/** Отрезок дат -> дни диапазона (0-based, включительно), обрезанные границами года; null, если целиком вне. */
export function daySpan(range: DayRange, from: string, to: string): { startDay: number; endDay: number } | null {
  const a = dayIndex(range.from, from);
  const b = dayIndex(range.from, to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < 0 || a > range.days - 1) return null;
  return { startDay: Math.max(0, a), endDay: Math.min(range.days - 1, Math.max(a, b)) };
}

/** Проценты ширины: левый край и ширина полосы [startDay..endDay] из days дней. */
export function spanPct(startDay: number, endDay: number, days: number): { left: number; width: number } {
  return { left: (startDay / days) * 100, width: ((endDay - startDay + 1) / days) * 100 };
}

/** Месяцы по реальным границам: начало (день диапазона) и длина. */
export function monthSpans(months: readonly { from: string; days: number }[], range: DayRange): { startDay: number; days: number }[] {
  return months.map((m) => ({ startDay: dayIndex(range.from, m.from), days: m.days }));
}

export type Lane = 'release' | 'queue';
export type Bar = {
  key: string; lane: Lane; item: PlanItem; seg: PlanSegment; segIndex: number; segCount: number;
  /** дни диапазона 0-based включительно */
  startDay: number; endDay: number; row: number;
  /** чередование тона соседних полос очереди (0/1) */
  alt: 0 | 1;
};

/**
 * Полосы по сегментам, позиция по ДНЯМ. Дорожки: релизы с галкой / очередь. Строка дорожки одна,
 * дополнительные строки только если полосы реально пересекаются по дням.
 */
export function layoutBars(items: readonly PlanItem[], range: DayRange): { bars: Bar[]; rows: Record<Lane, number> } {
  const raw: Omit<Bar, 'row' | 'alt'>[] = [];
  for (const item of items) {
    const lane: Lane = item.kind === 'release' ? 'release' : 'queue';
    item.segments.forEach((seg, i) => {
      const sp = daySpan(range, seg.from, seg.to);
      if (sp) raw.push({ key: item.key, lane, item, seg, segIndex: i, segCount: item.segments.length, ...sp });
    });
  }
  raw.sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.segIndex - b.segIndex);
  const bars: Bar[] = [];
  const rows: Record<Lane, number> = { release: 0, queue: 0 };
  for (const lane of ['release', 'queue'] as const) {
    const last: number[] = [];
    let n = 0;
    for (const r of raw.filter((b) => b.lane === lane)) {
      let row = last.findIndex((end) => end < r.startDay);
      if (row < 0) { row = last.length; last.push(-1); }
      last[row] = r.endDay;
      bars.push({ ...r, row, alt: (n++ % 2) as 0 | 1 });
    }
    rows[lane] = last.length;
  }
  return { bars, rows };
}

/** Номер (1-based) конфликта для каждого ключа. */
export function conflictNumbers(conflicts: readonly Conflict[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  conflicts.forEach((c, i) => {
    for (const k of c.keys) map.set(k, [...(map.get(k) ?? []), i + 1]);
  });
  return map;
}

// ---------- Склейка списков по key ----------
export type QueueRow = {
  key: string;
  entry: RoadmapEntry;
  state: QueueState;
  item: PlanItem | null;
  notFit: NotFitEntry | null;
  /** g:* = игра бэклога: участвует в ручном порядке */
  movable: boolean;
};
type JoinSrc = Pick<RoadmapResponse, 'queue' | 'items' | 'notFit' | 'needHours'>;

/** Все записи по key из items, notFit, needHours. */
export function entryMap(d: Pick<RoadmapResponse, 'items' | 'notFit' | 'needHours'>): Map<string, RoadmapEntry> {
  const m = new Map<string, RoadmapEntry>();
  for (const e of d.needHours) m.set(e.key, e);
  for (const e of d.notFit) m.set(e.key, e);
  for (const e of d.items) m.set(e.key, e);
  return m;
}

/** Очередь = `queue` в порядке API + запись из items/notFit/needHours. Записи без данных (no_budget/unplanned) пропускаются. */
export function buildQueueRows(d: JoinSrc): QueueRow[] {
  const entries = entryMap(d);
  const items = new Map(d.items.map((i) => [i.key, i]));
  const notFit = new Map(d.notFit.map((n) => [n.key, n]));
  const rows: QueueRow[] = [];
  for (const q of d.queue) {
    const entry = entries.get(q.key);
    if (!entry) continue;
    rows.push({ key: q.key, entry, state: q.state, item: items.get(q.key) ?? null, notFit: notFit.get(q.key) ?? null, movable: q.key.startsWith('g:') });
  }
  return rows;
}

/** Применить локальный порядок g:* (ключи) поверх очереди: g:* по порядку, неизвестные в конце, остальное после. */
export function applyOrder(rows: readonly QueueRow[], order: readonly string[] | null): QueueRow[] {
  const movable = rows.filter((r) => r.movable);
  const rest = rows.filter((r) => !r.movable);
  if (!order) return [...movable, ...rest];
  const pos = new Map(order.map((k, i) => [k, i]));
  const sorted = movable
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (pos.get(a.r.key) ?? 1e9) - (pos.get(b.r.key) ?? 1e9) || a.i - b.i)
    .map((x) => x.r);
  return [...sorted, ...rest];
}

/** gameId (число) из ключей `g:<id>`: тело PUT /api/roadmap/order. */
export function orderGameIds(keys: readonly string[]): number[] {
  return keys.filter((k) => k.startsWith('g:')).map((k) => Number(k.slice(2))).filter((n) => Number.isInteger(n) && n > 0);
}

// ---------- Перестановка ----------
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
}
export const moveBy = <T>(list: readonly T[], from: number, delta: number): T[] => moveTo(list, from, from + delta);

/** Индекс вставки после дропа на строку `over` с половиной `side`; null = положение не меняется. */
export function dropTarget(from: number, over: number, side: 'before' | 'after'): number | null {
  if (from === over) return null;
  let to = side === 'before' ? over : over + 1;
  if (from < to) to -= 1;
  return to === from ? null : to;
}
export function dropSide(clientY: number, rect: { top: number; height: number }): 'before' | 'after' {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

export const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);

export function positionText(title: string, index: number, total: number): string {
  return `${title}: позиция ${index + 1} из ${total}`;
}

// ---------- Тексты ----------
export function kindLabel(kind: RoadmapEntry['kind']): string {
  return kind === 'release' ? 'релиз' : kind === 'backlog' ? 'очередь' : 'очередь, релиз без галки';
}

export function hoursSourceLabel(src: RoadmapEntry['hoursSource']): string | null {
  return src === 'hltb' ? 'HLTB' : src === 'manual' ? 'вручную' : null;
}

export function periodText(item: PlanItem): string {
  const segs = item.segments;
  if (segs.length <= 1) return rangeText(item.start, item.end);
  const head = segs.slice(0, 2).map((s) => rangeText(s.from, s.to)).join(' и ');
  return segs.length > 2 ? `${head} и ещё ${segs.length - 2}` : head;
}

export function barLabel(b: Bar, conflicts: readonly number[]): string {
  const it = b.item;
  const kind = it.kind === 'release' ? `релиз, выходит ${it.releaseDate ? dayLong(it.releaseDate) : 'без даты'}` : 'очередь';
  const pos = it.queuePosition !== null ? `, позиция ${it.queuePosition}` : '';
  const sh = b.seg.hours;
  const hrs = `, ${hoursNum(sh)} ${plural(Math.round(sh), ['час', 'часа', 'часов'])}`;
  const conf = conflicts.length ? `, конфликт ${conflicts.join(', ')}` : '';
  return `${it.title}: ${kind}, с ${dayLong(it.start)} по ${dayLong(it.end)}, ${weeksWord(Math.max(1, Math.ceil(it.days / 7)))}${hrs}${pos}${conf}`;
}

/** Заголовок и пояснение конфликта (спека п.8, шаблоны по `reason` контракта). */
export type ExtraGames = ReadonlyMap<string, { title: string; releaseDate: string | null }>;

export function conflictText(
  c: Conflict, n: number, d: Pick<RoadmapResponse, 'items' | 'notFit' | 'needHours' | 'settings' | 'range'>, extra?: ExtraGames,
): { title: string; body: string } {
  const entries: Map<string, { title: string; releaseDate: string | null; hours?: number | null }> = new Map(extra ?? []);
  for (const [k, v] of entryMap(d)) entries.set(k, v);
  const itemsByKey = new Map(d.items.map((i) => [i.key, i]));
  const budget = d.settings.hoursPerWeek;
  const range = rangeText(c.from, c.to);
  const names = c.keys.map((k) => `«${entries.get(k)?.title ?? 'игра из плана'}»`);
  const describe = (k: string) => {
    const e = entries.get(k);
    const it = itemsByKey.get(k);
    const date = e?.releaseDate ? `выходит ${dayText(e.releaseDate)}` : 'без даты';
    const weeks = it ? `, ${weeksText(it.days)}` : '';
    return `«${e?.title ?? 'игра из плана'}» (${date}${weeks})`;
  };
  if (c.reason === 'release_overlap') {
    const list = c.keys.map(describe);
    const joined = list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`;
    const last = itemsByKey.get(c.keys[c.keys.length - 1] ?? '');
    const shift = last && last.shiftedDays > 0 ? ` Старт последней сдвинут на ${last.shiftedDays} дн.` : '';
    const b = budget !== null ? `При ${hoursLabel(budget)} в неделю` : 'При таком бюджете';
    return {
      title: `Конфликт ${n}: пересечение релизов, ${range}`,
      body: `${joined} занимают одни и те же недели. ${b} успеть в срок нельзя.${shift} Сдвинь дату, увеличь часы в неделю или сними галку «Хочу пройти на релизе» у одной из игр.`,
    };
  }
  if (c.reason === 'exceeds_year_end') {
    const k = c.keys[0];
    const e = k ? entries.get(k) : undefined;
    const it = k ? itemsByKey.get(k) : undefined;
    const nf = d.notFit.find((x) => x.key === k);
    const placed = it ? it.segments.reduce((s, x) => s + x.hours, 0) : 0;
    const over = nf?.hoursShort ?? (e?.hours != null ? Math.max(0, Math.round((e.hours - placed) * 10) / 10) : null);
    const need = e?.hours != null ? `, на неё нужно ${hoursLabel(e.hours)}` : '';
    const tail = over && over > 0 ? ` За пределы года выходят ${hoursLabel(over)}.` : '';
    return {
      title: `Конфликт ${n}: релиз не помещается в год, ${range}`,
      body: `${names[0] ?? '«Игра»'}${e?.releaseDate ? ` выходит ${dayText(e.releaseDate)}` : ''}${need}, а ${d.range.to.slice(0, 4)} год заканчивается ${dayText(d.range.to)}.${tail}`,
    };
  }
  if (c.reason === 'starts_before_year') {
    const k = c.keys[0];
    const e = k ? entries.get(k) : undefined;
    const year = d.range.from.slice(0, 4);
    const fromYear = c.from.slice(0, 4);
    const out = itemsByKey.get(k ?? '') ? 'В план попадает только часть внутри года, часы считаются по её дням.' : 'Окно целиком в прошлом году, в план она не попала.';
    return {
      title: `Конфликт ${n}: релиз вышел до начала года, ${rangeText(c.from, c.to)} ${fromYear}`,
      body: `${names[0] ?? '«игра из плана»'}${e?.releaseDate ? ` вышла ${dayYearText(e.releaseDate)}` : ' вышла до начала года'}, а план ${year} года начинается ${dayText(d.range.from)}. ${out}`,
    };
  }
  return { title: `Конфликт ${n}: план идёт вразрез, ${range}`, body: `Затронуты: ${names.join(', ')}.` };
}

export function notFitReasonText(r: NotFitEntry): string {
  if (r.reason === 'after_year_end') return 'Выходит после конца года плана';
  if (r.reason === 'exceeds_year_end') return 'После даты выхода не остаётся недель до конца года';
  return 'Недели до конца года заняты';
}
export function notFitShortText(r: NotFitEntry): string {
  return r.hoursShort !== null && r.hoursShort > 0 ? `не хватает ${hoursLabel(r.hoursShort)}` : 'не помещается в год';
}
export function totalShortHours(list: readonly NotFitEntry[]): number {
  return Math.round(list.reduce((s, r) => s + (r.hoursShort ?? 0), 0) * 10) / 10;
}

// ---------- Прогресс ----------
export type ProgressView =
  | { kind: 'empty' }
  | { kind: 'not_started'; year: number }
  | { kind: 'past'; year: number; actual: number; planned: number }
  | { kind: 'no_data' }
  | { kind: 'on_track' | 'ahead' | 'behind'; diff: number; planned: number; actual: number; scale: number; tolerance: number; from: string; asOf: string };

export function progressView(d: Pick<RoadmapResponse, 'progress' | 'items' | 'settings' | 'totals' | 'today'>): ProgressView {
  const p: Progress | null = d.progress;
  const year = d.settings.year;
  const nowYear = parseYmd(d.today)?.y ?? year;
  if (!p || d.items.length === 0) return { kind: 'empty' };
  if (p.status === 'not_started' || year > nowYear) return { kind: 'not_started', year };
  if (year < nowYear) return { kind: 'past', year, actual: p.actualHours, planned: p.plannedHours };
  if (p.status === 'no_data') return { kind: 'no_data' };
  const kind = p.status === 'onTrack' ? 'on_track' : p.status;
  return {
    kind, diff: p.diffHours, planned: p.plannedHours, actual: p.actualHours, scale: Math.max(d.totals.capacityHours, p.plannedHours, p.actualHours, 0.1),
    tolerance: p.toleranceHours, from: p.from, asOf: p.asOf,
  };
}
export const pct = (v: number, scale: number): number => Math.max(0, Math.min(100, (v / scale) * 100));

// ---------- Релизы ----------
export type ReleaseValues = {
  title: string; noDate: boolean; date: string; coverUrl: string; hours: string; want: boolean;
  externalId: string | null;
};
export type ReleaseErrors = Partial<Record<'title' | 'date' | 'cover' | 'hours' | 'want', string>>;

export function validateRelease(v: ReleaseValues): ReleaseErrors {
  const e: ReleaseErrors = {};
  if (!v.title.trim()) e.title = 'Введи название';
  else if (v.title.trim().length > 120) e.title = 'Название не длиннее 120 символов';
  if (!v.noDate && v.date.trim() && !isRealDate(v.date.trim())) e.date = 'Введи дату в формате ДД.ММ.ГГГГ';
  const hasDate = !v.noDate && isRealDate(v.date.trim());
  if (v.want && !hasDate) e.want = 'Для галки нужна дата релиза';
  if (v.coverUrl.trim() && !/^https:\/\/\S+$/i.test(v.coverUrl.trim())) e.cover = 'Ссылка должна начинаться с https://';
  if (v.hours.trim() && parseRowHours(v.hours) === null) e.hours = `Введи число от ${hoursNum(ROW_HOURS_MIN)} до ${ROW_HOURS_MAX}`;
  return e;
}

export type PlannedBody = {
  title: string; releaseDate: string | null; coverUrl: string | null; wantAtRelease: boolean; hoursManual: number | null;
  externalSource?: 'rawg'; externalId?: string;
};
export function toPlannedBody(v: ReleaseValues, withExternal: boolean): PlannedBody {
  const hasDate = !v.noDate && isRealDate(v.date.trim());
  const body: PlannedBody = {
    title: v.title.trim(),
    releaseDate: hasDate ? v.date.trim() : null,
    coverUrl: v.coverUrl.trim() || null,
    wantAtRelease: v.want && hasDate,
    hoursManual: v.hours.trim() ? parseRowHours(v.hours) : null,
  };
  if (withExternal && v.externalId) { body.externalSource = 'rawg'; body.externalId = v.externalId; }
  return body;
}
export function valuesFromPlanned(g: PlannedGameDto): ReleaseValues {
  return {
    title: g.title, noDate: g.releaseDate === null, date: g.releaseDate ?? '', coverUrl: g.coverUrl ?? '', hours: hoursFieldValue(g.hoursManual),
    want: g.wantAtRelease, externalId: g.externalId,
  };
}
export const emptyValues = (): ReleaseValues => ({ title: '', noDate: false, date: '', coverUrl: '', hours: '', want: false, externalId: null });

/** Тело POST для отмены удаления. */
export function recreateBody(g: PlannedGameDto): PlannedBody {
  const b: PlannedBody = { title: g.title, releaseDate: g.releaseDate, coverUrl: g.coverUrl, wantAtRelease: g.wantAtRelease, hoursManual: g.hoursManual };
  if (g.externalSource && g.externalId) { b.externalSource = g.externalSource; b.externalId = g.externalId; }
  return b;
}

export function isReleased(g: Pick<PlannedGameDto, 'releaseDate'>, todayIso: string): boolean {
  return g.releaseDate !== null && g.releaseDate <= todayIso;
}
export function outsideYear(releaseDate: string | null, year: number): boolean {
  return releaseDate !== null && isRealDate(releaseDate) && !releaseDate.startsWith(`${year}-`);
}

/** Строка релиза: порядок по дате (без даты в конце), затем id. */
export function sortPlanned(list: readonly PlannedGameDto[]): PlannedGameDto[] {
  return [...list].sort((a, b) => (a.releaseDate ?? '9999') .localeCompare(b.releaseDate ?? '9999') || a.id - b.id);
}

// ---------- Каталог ----------
export type CatalogCandidateView = {
  externalSource: 'rawg'; externalId: string; title: string; releaseDate: string | null; coverUrl: string | null; platforms: string[]; playstation: boolean;
};
export function filterCandidates<T extends { playstation: boolean }>(list: readonly T[], onlyPlayStation: boolean): T[] {
  return onlyPlayStation ? list.filter((c) => c.playstation) : [...list];
}
const PS_SHORT: Record<string, string> = { 'PlayStation 5': 'PS5', 'PlayStation 4': 'PS4', 'PlayStation 3': 'PS3', 'PlayStation 2': 'PS2', PlayStation: 'PS1', 'PS Vita': 'PS Vita' };
export function platformsText(platforms: readonly string[]): string {
  const ps = platforms.filter((p) => p.startsWith('PlayStation') || p === 'PS Vita');
  const list = (ps.length ? ps : platforms).map((p) => PS_SHORT[p] ?? p);
  const shown = list.slice(0, 4);
  return shown.join(', ') + (list.length > 4 ? ` +${list.length - 4}` : '');
}
export function candidateMeta(c: Pick<CatalogCandidateView, 'releaseDate' | 'platforms'>): string {
  const date = c.releaseDate ? dayYearText(c.releaseDate) : 'Дата не объявлена';
  const pl = platformsText(c.platforms);
  return pl ? `${date} · ${pl}` : date;
}

export type CatalogFailKind = 'not_configured' | 'rate_limited' | 'unavailable';
export function catalogFail(reason: string | undefined): { kind: CatalogFailKind; text: string } {
  if (reason === 'no_key') return { kind: 'not_configured', text: 'Поиск по каталогу не настроен. Заполни форму вручную.' };
  if (reason === 'rate_limited') return { kind: 'rate_limited', text: 'Лимит запросов к каталогу исчерпан. Попробуй позже или заполни форму вручную.' };
  return { kind: 'unavailable', text: 'Каталог сейчас недоступен. Заполни форму ниже вручную.' };
}

/** Текст ошибки мутации по статусу и коду. */
export function mutationErrorText(status: number, code: string, reason?: string): string {
  if (code === 'planned_duplicate') return 'Эта игра уже есть в плане.';
  if (reason === 'want_requires_release_date') return 'Для галки нужна дата релиза.';
  if (status === 404) return 'Игра не найдена. Обнови страницу.';
  if (status === 400) return 'Сервер отклонил данные. Проверь поля.';
  if (status === 503) return 'База данных недоступна.';
  if (status === 401) return 'Сессия истекла. Войди заново.';
  return 'Нет связи с сервером.';
}

// ---------- Состояние релиза в плане ----------
export type PlannedPlanState = { kind: 'scheduled' | 'need_hours' | 'not_fit' | 'unknown'; conflicts: number[] };
/** Что план делает с релизом/игрой `p:<id>`: стоит, нужны часы, не успеваю. */
export function plannedPlanState(
  id: number, d: Pick<RoadmapResponse, 'items' | 'notFit' | 'needHours' | 'conflicts'>,
): PlannedPlanState {
  const key = `p:${id}`;
  const conflicts = conflictNumbers(d.conflicts).get(key) ?? [];
  if (d.items.some((i) => i.key === key)) return { kind: 'scheduled', conflicts };
  if (d.notFit.some((i) => i.key === key)) return { kind: 'not_fit', conflicts };
  if (d.needHours.some((i) => i.key === key)) return { kind: 'need_hours', conflicts };
  return { kind: 'unknown', conflicts };
}

// ---------- Скрытые из очереди «Не успеваю», полный порядок ----------
/** В очереди показываем всё, кроме `not_fit`: такие игры живут только в блоке «Не успеваю». */
export const visibleQueue = (rows: readonly QueueRow[]): QueueRow[] => rows.filter((r) => r.state !== 'not_fit');

/**
 * Полный порядок g:* после перестановки среди видимых: скрытые игры (not_fit) сохраняют свои места,
 * видимые занимают остальные места в новом порядке `visible`. Контракт 17.8: PUT получает порядок ВСЕХ игр очереди.
 */
export function mergeVisibleOrder(full: readonly string[], visible: readonly string[]): string[] {
  const fullSet = new Set(full);
  const present = visible.filter((k) => fullSet.has(k));
  const vset = new Set(present);
  if (full.filter((k) => vset.has(k)).length !== present.length) return [...full];
  let j = 0;
  return full.map((k) => (vset.has(k) ? present[j++] : k));
}

// ---------- Предстоящие релизы ----------
export type UpcomingCandidate = CatalogCandidateView & { planned: boolean; unallocated: boolean; plannedId: number | null };
export type UpcomingState = 'new' | 'planned' | 'unallocated';

/**
 * Состояние строки каталога по ВСЕМ записям планируемых игр (любой статус): ищем по externalId и по plannedId.
 * Запись `cancelled` = «Не распределено», `planned`/`done` = «В плане», записи нет (удалена) = можно добавить заново.
 * Пока список записей не загружен, берём пометки каталога.
 */
export function upcomingState(
  c: Pick<UpcomingCandidate, 'planned' | 'unallocated' | 'plannedId' | 'externalId'>, all: readonly Pick<PlannedGameDto, 'id' | 'status' | 'externalId'>[] | null,
): { state: UpcomingState; plannedId: number | null } {
  if (!all) return { state: c.unallocated ? 'unallocated' : c.planned ? 'planned' : 'new', plannedId: c.plannedId };
  const rec = all.find((g) => g.externalId !== null && g.externalId === c.externalId) ?? (c.plannedId !== null ? all.find((g) => g.id === c.plannedId) : undefined);
  if (!rec) return { state: 'new', plannedId: null };
  return { state: rec.status === 'cancelled' ? 'unallocated' : 'planned', plannedId: rec.id };
}

/** Тело POST «В план» из строки каталога: галка «на релизе» включена, часы потом вручную. */
export function upcomingBody(c: Pick<UpcomingCandidate, 'title' | 'releaseDate' | 'coverUrl' | 'externalId'>): PlannedBody {
  return { title: c.title.slice(0, 120), releaseDate: c.releaseDate, coverUrl: c.coverUrl, wantAtRelease: c.releaseDate !== null, hoursManual: null, externalSource: 'rawg', externalId: c.externalId };
}

/** Дописать страницу без повторов (порядок сохраняется). */
export function appendUnique(list: readonly UpcomingCandidate[], more: readonly UpcomingCandidate[]): UpcomingCandidate[] {
  const seen = new Set(list.map((c) => c.externalId));
  return [...list, ...more.filter((c) => !seen.has(c.externalId))];
}

// ---------- Единое расписание (очередь = игры бэклога + релизы по датам) ----------
const rank = (r: QueueRow): number => (r.key.startsWith('p:') ? 0 : 1);
/** Дата для сортировки: начало в плане; у релиза без часов (нет периода) дата выхода. */
const sortDate = (r: QueueRow): string | null => r.item?.start ?? (r.key.startsWith('p:') ? r.entry.releaseDate : null);
function cmpStart(a: QueueRow, b: QueueRow): number {
  const x = sortDate(a) as string;
  const y = sortDate(b) as string;
  if (x !== y) return x < y ? -1 : 1;
  return rank(a) - rank(b) || (a.item?.queuePosition ?? 1e9) - (b.item?.queuePosition ?? 1e9) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Список очереди = единое расписание: items (бэклог, релизы с галкой и без) по start; релизы без часов, но с датой выхода,
 * стоят по дате выхода (периода у них нет); игры бэклога без часов и релизы без часов и без даты в конце. Скрыты `not_fit`.
 * Строки бэклога (g:*) переставляются между своими местами в порядке `order` (оптимистично, до пересчёта),
 * релизные строки остаются на местах по дате.
 */
export function buildSchedule(d: JoinSrc, order: readonly string[] | null): QueueRow[] {
  const base = buildQueueRows(d);
  const inQueue = new Set(base.map((r) => r.key));
  const extra: QueueRow[] = d.items.filter((i) => !inQueue.has(i.key)).map((i) => ({ key: i.key, entry: i, state: 'scheduled' as const, item: i, notFit: null, movable: false }));
  // релиз с галкой без часов в queue не входит, но в расписании виден по дате выхода
  const seen = new Set([...inQueue, ...extra.map((r) => r.key)]);
  const needRel: QueueRow[] = d.needHours
    .filter((e) => e.key.startsWith('p:') && e.releaseDate && !seen.has(e.key))
    .map((e) => ({ key: e.key, entry: e, state: 'need_hours' as const, item: null, notFit: null, movable: false }));
  const all = [...base, ...extra, ...needRel].filter((r) => r.state !== 'not_fit');
  const sched = [...all.filter((r) => sortDate(r)).sort(cmpStart), ...all.filter((r) => !sortDate(r))];
  const ordered = applyOrder(sched.filter((r) => r.movable), order);
  let j = 0;
  return sched.map((r) => (r.movable ? ordered[j++] : r));
}

/** Номера позиций бэклога 1..N только по g:* (релизные строки номера не имеют). */
export function backlogPositions(rows: readonly QueueRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.movable) m.set(r.key, m.size + 1);
  return m;
}
export const backlogKeys = (rows: readonly QueueRow[]): string[] => rows.filter((r) => r.movable).map((r) => r.key);

/** Drop на строку `over`: новый порядок g:* (цель считается только среди g:*; релизные строки целью не бывают), null = без изменений. */
export function dropOrder(rows: readonly QueueRow[], dragKey: string, overKey: string, side: 'before' | 'after'): string[] | null {
  const keys = backlogKeys(rows);
  const from = keys.indexOf(dragKey);
  const over = keys.indexOf(overKey);
  if (from < 0 || over < 0) return null;
  const to = dropTarget(from, over, side);
  return to === null ? null : moveTo(keys, from, to);
}

// ---------- «Не успеваю»: на какую позицию поставить игру (поля backend insertAt, displacesAtInsert, displacedTitles; контракт 17.15) ----------
export type NotFitView = NotFitEntry & { insertAt?: number | null; displacesAtInsert?: number | null; displacedTitles?: string[] | null };

export type InsertHint =
  | { kind: 'insert'; at: number; displaces: number; line: string; warn: boolean }
  | { kind: 'never'; line: string };

/** Подсказка по строке «Не успеваю»: null = полей нет (проба не считалась) или это не g:* с no_capacity. */
export function insertHint(e: NotFitView): InsertHint | null {
  if (!e.key.startsWith('g:') || e.reason !== 'no_capacity' || e.insertAt === undefined) return null;
  if (e.insertAt === null) {
    return e.displacesAtInsert === null || e.displacesAtInsert === undefined ? null : { kind: 'never', line: 'Нигде не влезет: слишком длинная или мешают релизы' };
  }
  const n = e.displacesAtInsert ?? 0;
  const titles = (e.displacedTitles ?? []).map((t) => `«${t}»`).join(', ');
  return {
    kind: 'insert', at: e.insertAt, displaces: n, warn: n > 0,
    line: n > 0 ? `Влезет на позиции ${e.insertAt}, вытеснит ${n}${titles ? `: ${titles}` : ''}` : `Влезет на позиции ${e.insertAt}, никого не вытеснит`,
  };
}

/** Полный порядок g:* с игрой `key` на позиции `at` (1-based) среди всех g:* очереди; вставка по ключам, остальной порядок сохраняется. */
export function orderWithAtPosition(full: readonly string[], key: string, at: number): string[] {
  if (!full.includes(key)) return [...full];
  const rest = full.filter((k) => k !== key);
  const i = Math.max(0, Math.min(rest.length, Math.floor(at) - 1));
  return [...rest.slice(0, i), key, ...rest.slice(i)];
}

export const placedToast = (pos: number, before: number, after: number): string => `Поставлено на позицию ${pos}. Не успеваю: было ${before}, стало ${after}`;

/** Текст тоста после «Убрать из плана»: сколько игр было и стало в «Не успеваю». */
export function removedToast(before: number, after: number): string {
  return before === 0 && after === 0 ? 'Убрано из плана' : `Убрано из плана. Не успеваю: было ${before}, стало ${after}`;
}

// ---------- Пакет 6, п. 11: прогноз бэклога ----------
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

export type PaceView = { kind: 'ok' | 'info'; title: string; note: string | null };

/** «последних 4 недель» или «последних 15 дней» (история часов моложе 4 недель). */
function windowWords(days: number): string {
  return days >= 28 ? 'последних 4 недель' : `последних ${days} ${plural(days, ['дня', 'дней', 'дней'])}`;
}

/** Текст блока «Прогноз бэклога»; null — старый ответ без поля. */
export function paceView(p: NonNullable<RoadmapResponse['pace']> | undefined): PaceView | null {
  if (!p) return null;
  const unknown = p.unknownGames > 0
    ? ` ${p.unknownGames === p.games ? 'У игр' : `У ${p.unknownGames} ${plural(p.unknownGames, ['игры', 'игр', 'игр'])}`} нет длительности — ${p.unknownGames === 1 ? 'она не учтена' : 'они не учтены'}.`
    : '';
  if (p.status === 'empty') return { kind: 'info', title: 'Бэклог пуст', note: null };
  if (p.status === 'no_hours') return { kind: 'info', title: 'Прогноза нет: у игр бэклога нет длительности', note: 'Укажите часы в бэклоге — и здесь появится дата.' };
  if (p.status === 'no_data') return { kind: 'info', title: 'Прогноз появится через неделю истории часов', note: 'Темп считается по ежедневным снимкам синка.' };
  if (p.status === 'no_pace') return { kind: 'info', title: `За ${p.days >= 28 ? 'последние 4 недели' : `последние ${p.days} ${plural(p.days, ['день', 'дня', 'дней'])}`} игр не было — темп не посчитать`, note: `В бэклоге ${hoursLabel(p.backlogHours)}.${unknown}` };
  const d = p.closeDate ? parseYmd(p.closeDate) : null;
  const years = p.weeks === null ? 0 : p.weeks / 52.18;
  const when = !d ? '' : years > 100 ? 'больше чем через 100 лет' : `≈ в ${MONTHS_IN[d.m - 1]} ${d.y}`;
  return {
    kind: 'ok',
    title: `Бэклог закончится ${when}`,
    note: `В темпе ${windowWords(p.days)}: ${hoursLabel(p.hoursPerWeek)} в неделю, в бэклоге ${hoursLabel(p.backlogHours)}.${unknown}`,
  };
}
