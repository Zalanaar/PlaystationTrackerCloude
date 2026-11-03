// Чистая логика полосы «С прошлого визита» (docs/design/spec-phase-28-inbox.md, A.2): чипы, тексты, скрытие до 00:00 МСК.
import type { InboxResponse } from '@/server/inbox/query';
import { formatPlayTime, mskParts, plural } from '../format';

export type { InboxResponse };

export type ChipId = 'match' | 'new' | 'trophies' | 'hours' | 'check' | 'forgotten';
export type Seg = { t: string; num?: boolean };
export type InboxIcon = 'circle-help' | 'plus-circle' | 'trophy' | 'trending-up' | 'trending-down' | 'minus' | 'check-circle' | 'clock';

export type Chip = {
  id: ChipId;
  testid: string;
  /** Чип-ссылка. У чипа «Это та игра?» ссылки нет: он открывает лист (Фаза 43) */
  href: string;
  /** true = кнопка, открывает лист подтверждения вместо перехода */
  opensSheet?: boolean;
  icon: InboxIcon;
  /** Окно чипов 1-2 (data-window) */
  window?: 'h24' | 'd7';
  /** Платина > 0: платиновая иконка и рамка */
  platinum?: boolean;
  /** Чипы-действия заканчиваются chevron-right (на мобильном он скрыт стилем) */
  action: boolean;
  desktop: Seg[];
  mobile: Seg[];
  aria: string;
};

/** Разница меньше 15 минут считается «как на прошлой неделе» */
export const HOURS_SAME_SEC = 15 * 60;
/** На мобильном видны 4 чипа, пятый уходит под «Ещё 1» (сначала скрываются часы) */
export const MOBILE_LIMIT = 4;

const num = (n: number): Seg => ({ t: String(n), num: true });
const txt = (t: string): Seg => ({ t });
const pos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

const winLabel = (w: 'h24' | 'd7') => (w === 'h24' ? 'за 24 ч' : 'за 7 дн.');
const winAria = (w: 'h24' | 'd7') => (w === 'h24' ? 'за 24 часа' : 'за 7 дней');
const toWin = (w: '24h' | '7d' | null): 'h24' | 'd7' | null => (w === '24h' ? 'h24' : w === '7d' ? 'd7' : null);

const secs = (hours: number | null | undefined): number => (typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : 0);
const dur = (s: number): string => formatPlayTime(s) ?? '0 м';

/** Фаза 43: вопросы «Это та игра?». Первый по порядку; ✕ его не скрывает, на мобильном он не прячется под «Ещё». */
function matchChip(d: InboxResponse): Chip | null {
  if (!pos(d.matchCount)) return null;
  const n = d.matchCount;
  return {
    id: 'match', testid: 'inbox-match', href: '', opensSheet: true, icon: 'circle-help', action: true,
    desktop: [txt('Это та игра? '), num(n)], mobile: [txt('Это та игра? '), num(n)], aria: `Это та игра? Совпадений: ${n}`,
  };
}

function newChip(d: InboxResponse): Chip | null {
  const w = toWin(d.newGamesWindow);
  if (!w || !pos(d.newGames) || !pos(d.newUnsorted)) return null;
  const n = d.newGames;
  const m = d.newUnsorted;
  return {
    id: 'new', testid: 'inbox-new', href: '/triage', icon: 'plus-circle', window: w, action: true,
    desktop: [txt('+'), num(n), txt(` ${plural(n, ['новая игра', 'новые игры', 'новых игр'])} ${winLabel(w)} · Разобрать `), num(m)],
    mobile: [txt('+'), num(n), txt(` ${plural(n, ['новая', 'новые', 'новых'])} · Разобрать `), num(m)],
    aria: `Новые игры: ${n} ${winAria(w)}. Разобрать ${m}`,
  };
}

function trophiesChip(d: InboxResponse): Chip | null {
  const w = toWin(d.trophiesWindow);
  if (!w || !pos(d.trophies)) return null;
  const n = d.trophies;
  const p = pos(d.platinums) ? d.platinums : 0;
  return {
    id: 'trophies', testid: 'inbox-trophies', href: '/trophies?period=7d', icon: 'trophy', window: w, platinum: p > 0, action: false,
    desktop: [txt('+'), num(n), txt(` ${plural(n, ['трофей', 'трофея', 'трофеев'])} ${winLabel(w)}`), ...(p > 0 ? [txt(', платин: '), num(p)] : [])],
    mobile: [txt('+'), num(n), txt(` ${plural(n, ['трофей', 'трофея', 'трофеев'])}`), ...(p > 0 ? [txt(', '), num(p), txt(' плат.')] : [])],
    aria: `Трофеи: ${n} ${winAria(w)}${p > 0 ? `, платин: ${p}` : ''}`,
  };
}

export type HoursCompare = { week: number; diff: number | null; trend: 'up' | 'down' | 'same' | null };

/** Сравнение недель в секундах. prev = null: прошлая неделя неполная, сравнения нет. */
export function compareHours(weekHours: number | null | undefined, prevHours: number | null | undefined): HoursCompare {
  const week = secs(weekHours);
  if (prevHours === null || prevHours === undefined) return { week, diff: null, trend: null };
  const diff = week - secs(prevHours);
  return { week, diff, trend: Math.abs(diff) < HOURS_SAME_SEC ? 'same' : diff > 0 ? 'up' : 'down' };
}

function hoursChip(d: InboxResponse): Chip | null {
  if (d.hoursNoHistory) return null;
  if (!pos(d.hoursWeek) && !pos(d.hoursPrevWeek)) return null;
  const c = compareHours(d.hoursWeek, d.hoursPrevWeek);
  const w = dur(c.week);
  const base = { id: 'hours' as const, testid: 'inbox-hours', href: '/stats', action: false };
  if (c.trend === null || c.diff === null) {
    return { ...base, icon: 'minus', desktop: [txt('Неделя: '), { t: w, num: true }], mobile: [txt('Неделя: '), { t: w, num: true }], aria: `Часы за неделю: ${w}` };
  }
  if (c.trend === 'same') {
    return {
      ...base, icon: 'minus', desktop: [txt('Неделя: '), { t: w, num: true }, txt(', как на прошлой')],
      mobile: [{ t: w, num: true }, txt(' · как на прошлой')], aria: `Часы за неделю: ${w}, как на прошлой неделе`,
    };
  }
  const up = c.trend === 'up';
  const delta = dur(Math.abs(c.diff));
  return {
    ...base, icon: up ? 'trending-up' : 'trending-down',
    desktop: [txt('Неделя: '), { t: w, num: true }, txt(', на '), { t: delta, num: true }, txt(up ? ' больше прошлой' : ' меньше прошлой')],
    mobile: [{ t: w, num: true }, txt(' · '), { t: `${up ? '+' : '−'}${delta}`, num: true }],
    aria: `Часы за неделю: ${w}, на ${delta} ${up ? 'больше' : 'меньше'} прошлой недели`,
  };
}

/** Чипы в порядке A.2; пустые не включаются. Окна и пороги считает сервер, здесь только показ. */
export function buildChips(d: InboxResponse | null): Chip[] {
  if (!d) return [];
  const out: (Chip | null)[] = [matchChip(d), newChip(d), trophiesChip(d), hoursChip(d)];
  if (pos(d.checkCount)) {
    out.push({
      id: 'check', testid: 'inbox-check', href: '/triage?mode=check', icon: 'check-circle', action: true,
      desktop: [txt('Проверить статусы: '), num(d.checkCount)], mobile: [txt('Проверить статусы: '), num(d.checkCount)], aria: `Проверить статусы: ${d.checkCount}`,
    });
  }
  if (pos(d.forgottenCount)) {
    out.push({
      id: 'forgotten', testid: 'inbox-forgotten', href: '/triage?forgotten=1', icon: 'clock', action: true,
      desktop: [txt('Забытые: '), num(d.forgottenCount)], mobile: [txt('Забытые: '), num(d.forgottenCount)], aria: `Забытые игры: ${d.forgottenCount}`,
    });
  }
  return out.filter((c): c is Chip => c !== null);
}

/** Мобильный лимит: при 5 чипах скрыты часы (сначала скрывается 3). Остальные порядки сохраняются. */
export function splitMobile(chips: readonly Chip[], expanded: boolean): { visible: Chip[]; hidden: Chip[] } {
  if (expanded || chips.length <= MOBILE_LIMIT) return { visible: [...chips], hidden: [] };
  const hidden: Chip[] = [];
  const visible = [...chips];
  const hoursAt = visible.findIndex((c) => c.id === 'hours');
  // часы скрываются первыми; если их нет, скрывается последний чип (но не «Это та игра?»)
  const last = visible.length - 1;
  hidden.push(...visible.splice(hoursAt >= 0 ? hoursAt : visible[last].id === 'match' ? 0 : last, 1));
  while (visible.length > MOBILE_LIMIT) {
    const at = visible.length - 1;
    if (visible[at].id === 'match') break;
    hidden.unshift(...visible.splice(at, 1));
  }
  return { visible, hidden };
}

/** Чипы, которые остаются при «Скрыть на сегодня»: подтверждение совпадений не прячется, пока вопросы есть (Фаза 43). */
export function chipsWhenHidden(chips: readonly Chip[]): Chip[] {
  return chips.filter((c) => c.id === 'match');
}

export function segText(segs: readonly Seg[]): string {
  return segs.map((s) => s.t).join('');
}

// ---------- скрытие до 00:00 МСК ----------

export const hideKey = (userId: number | string): string => `ps-inbox-hide:${userId}`;

/** YYYY-MM-DD по Москве */
export function mskDay(ms: number): string {
  const p = mskParts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Скрыта ли полоса сейчас: в хранилище сегодняшняя дата МСК. Вчерашняя и мусор = показываем. */
export function isHiddenToday(stored: string | null | undefined, nowMs: number): boolean {
  return typeof stored === 'string' && stored === mskDay(nowMs);
}

// ---------- состояние загрузки ----------

export type InboxState = 'loading' | 'ready' | 'error' | 'gone';

/** Скелет живёт максимум 3 с, потом строка ошибки (запрос при этом не отменяется). */
export const SKELETON_MAX_MS = 3000;
