// Чистая логика Итогов (design-system §4.12): навигация, таймер, жесты, форматирование. Без DOM и React.
import type { WrappedResponse, WrappedSlideId } from '@/server/wrapped/types';
import { plural } from '../format';

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
/** Левые 30% экрана ведут назад. */
export const BACK_ZONE = 0.3;
/** Свайп: минимальный сдвиг по X, px. */
export const SWIPE_MIN_PX = 50;
/** Касание считается тапом, если палец сдвинулся меньше, px. */
export const TAP_MAX_MOVE_PX = 10;
/** Удержание дольше этого времени паузит слайд, мс. */
export const HOLD_MS = 250;
export const COUNTER_MS = 900;
export const CASCADE_STEP_MS = 80;
/** Запасное значение, если токен --dur-slide не прочитался. */
export const DEFAULT_SLIDE_MS = 7000;

const KNOWN: readonly WrappedSlideId[] = ['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'final', 'empty'];

/** Год из URL: целое 2000..2100, иначе null (тогда API берёт текущий год по Москве). */
export function parseYearParam(raw: string | null): number | null {
  if (raw === null || !/^\d{4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= MIN_YEAR && n <= MAX_YEAR ? n : null;
}

/**
 * Слайды строго по ответу сервера; неизвестные id отбрасываются.
 * «Год без данных» (один слайд empty) определяется только `mode: 'empty'` (контракт §11.1), а не по содержимому `slides`.
 * Контракт гарантирует `start` и `final` в `story`; пустой список (сбой контракта) не оставляет экран без слайдов.
 */
export function resolveSlides(data: Pick<WrappedResponse, 'slides' | 'mode'>): WrappedSlideId[] {
  if (data.mode === 'empty') return ['empty'];
  const list = data.slides.filter((s, i, a) => KNOWN.includes(s) && s !== 'empty' && a.indexOf(s) === i);
  return list.length ? list : ['start', 'final'];
}

// ---------- навигация ----------
export type Dir = 'next' | 'prev';

/** Новый индекс. На краях остаётся на месте (последний слайд не закрывается, перед первым некуда). */
export function stepIndex(index: number, dir: Dir, count: number): number {
  const last = Math.max(0, count - 1);
  const next = dir === 'next' ? index + 1 : index - 1;
  return Math.min(last, Math.max(0, next));
}

export const isLastIndex = (index: number, count: number) => index >= count - 1;

/** Тап: левые 30% назад, остальное вперёд. */
export function tapDirection(x: number, width: number): Dir {
  if (!(width > 0)) return 'next';
  return x / width < BACK_ZONE ? 'prev' : 'next';
}

export type GestureInput = { dx: number; dy: number; durationMs: number; x: number; width: number };
export type Gesture = { kind: 'tap'; dir: Dir } | { kind: 'swipe'; dir: Dir } | { kind: 'hold' } | { kind: 'none' };

/**
 * Итог жеста по его концу. Горизонтальный сдвиг от SWIPE_MIN_PX и больше вертикального = свайп
 * (влево -> вперёд, вправо -> назад). Почти без сдвига: долго = удержание (пауза, без перехода), коротко = тап.
 */
export function classifyGesture(g: GestureInput): Gesture {
  const ax = Math.abs(g.dx);
  const ay = Math.abs(g.dy);
  if (ax >= SWIPE_MIN_PX && ax > ay) return { kind: 'swipe', dir: g.dx < 0 ? 'next' : 'prev' };
  if (ax < TAP_MAX_MOVE_PX && ay < TAP_MAX_MOVE_PX) {
    return g.durationMs >= HOLD_MS ? { kind: 'hold' } : { kind: 'tap', dir: tapDirection(g.x, g.width) };
  }
  return { kind: 'none' };
}

export type Key = { key: string; ctrl?: boolean; meta?: boolean; alt?: boolean; onButton?: boolean };
export type KeyAction = Dir | 'close' | null;

/** Клавиши истории. Пробел и Enter на кнопке оставляем кнопке. */
export function keyAction(k: Key): KeyAction {
  if (k.ctrl || k.meta || k.alt) return null;
  if (k.key === 'Escape') return 'close';
  if (k.key === 'ArrowRight') return 'next';
  if (k.key === 'ArrowLeft') return 'prev';
  if ((k.key === ' ' || k.key === 'Spacebar') && !k.onButton) return 'next';
  return null;
}

// ---------- таймер ----------
export type TimerState = { elapsed: number };
export const TIMER_START: TimerState = { elapsed: 0 };
export const MAX_FRAME_MS = 100;

/** Шаг таймера. dt ограничен (вкладка в фоне не прокручивает слайды). На паузе или без автоперехода не двигается. */
export function tickTimer(
  s: TimerState, dtMs: number, o: { duration: number; paused: boolean; auto: boolean },
): { state: TimerState; done: boolean } {
  if (!o.auto || o.paused || !(o.duration > 0)) return { state: s, done: false };
  const dt = Math.min(Math.max(0, dtMs), MAX_FRAME_MS);
  const elapsed = Math.min(o.duration, s.elapsed + dt);
  return { state: { elapsed }, done: elapsed >= o.duration };
}

export const timerFraction = (s: TimerState, duration: number) => (duration > 0 ? Math.min(1, s.elapsed / duration) : 0);

/** «7000ms» / «7s» / «7000» -> мс. */
export function parseDurationMs(raw: string | null | undefined, fallback = DEFAULT_SLIDE_MS): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/.exec(raw ?? '');
  if (!m) return fallback;
  const v = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  return v > 0 ? v : fallback;
}

/** Доля заполнения сегмента: прошедшие 1, будущие 0, текущий по таймеру (или 1 при ручном режиме). */
export function segmentFill(i: number, current: number, fraction: number, auto: boolean): number {
  if (i < current) return 1;
  if (i > current) return 0;
  return auto ? fraction : 1;
}

/** Автопереход нужен, если нет reduced-motion, слайд не последний и не empty. */
export function isAutoAdvance(o: { reducedMotion: boolean; index: number; count: number; slide: WrappedSlideId | undefined }): boolean {
  return !o.reducedMotion && o.slide !== 'empty' && o.slide !== 'final' && !isLastIndex(o.index, o.count);
}

// ---------- счётчик ----------
/** Значение счётчика на момент t (ease-out). Reduced-motion: сразу цель. */
export function counterValue(elapsed: number, target: number, o: { duration?: number; reducedMotion?: boolean } = {}): number {
  const d = o.duration ?? COUNTER_MS;
  if (o.reducedMotion || elapsed >= d || d <= 0) return target;
  const t = Math.max(0, elapsed) / d;
  return target * (1 - Math.pow(1 - t, 3));
}

/** Задержка появления n-го элемента каскада. */
export const cascadeDelay = (n: number, reducedMotion: boolean) => (reducedMotion ? 0 : n * CASCADE_STEP_MS);

// ---------- форматирование ----------
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

/** «октябре» по номеру 1..12 (на клиенте, API отдаёт только номер). */
export function monthPrepositional(m: number): string {
  return MONTHS_PREP[m - 1] ?? '';
}

/** «в октябре». */
export const inMonth = (m: number) => (MONTHS_PREP[m - 1] ? `в ${MONTHS_PREP[m - 1]}` : '');

/** «≈ 17 дней». Меньше полусуток: «меньше суток». */
export function daysText(days: number | null): string | null {
  if (days === null || !Number.isFinite(days)) return null;
  const n = Math.round(days);
  if (n < 1) return 'меньше суток';
  return `≈ ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

export const gamesText = (n: number) => `${n} ${plural(n, ['игра', 'игры', 'игр'])}`;
export const trophiesText = (n: number) => `${n} ${plural(n, ['трофей', 'трофея', 'трофеев'])}`;
export const launchesLabel = (n: number) => `${n} ${plural(n, ['запуск', 'запуска', 'запусков'])}`;

/** Часы с одним знаком: «412,4». */
export function hoursText(n: number): string {
  const r = Math.round(n * 10) / 10;
  const [int, frac] = r.toFixed(1).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac === '0' ? grouped : `${grouped},${frac}`;
}

/** Инициал для аватара-плейсхолдера. */
export function initialOf(onlineId: string | null): string {
  const c = (onlineId ?? '').trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

/** «2026-03-04» -> «04.03.2026». */
export function syncStartedText(day: string | null): string | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? `Синк начался ${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Плашка слайда «Часы». */
export function partialBadge(firstSnapshotDate: string | null): string {
  const m = firstSnapshotDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstSnapshotDate) : null;
  return m ? `Часы считаются с даты первого синка (${m[3]}.${m[2]}.${m[1]})` : 'Часы считаются с даты первого синка';
}

/** Плашка слайда «Часы» при оценке (design-system §4.12). Дата первого синка = граница оценки. */
export function estimateBadge(firstSnapshotDate: string | null): string {
  const m = firstSnapshotDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstSnapshotDate) : null;
  const rule = 'распределены равномерно между первым и последним запуском игры';
  return m ? `До ${m[3]}.${m[2]}.${m[1]} часы оценены: ${rule}` : `Часы оценены: ${rule}`;
}

/** Часы с «≈» перед числом, если в них есть оценка. */
export const approxHours = (hours: number, estimated: boolean) => `${estimated ? '≈ ' : ''}${hoursText(hours)}`;

/** Доля бара жанра 0..1 относительно максимума. */
export function genreShare(value: number, max: number): number {
  return max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
}

/** Фоновая обложка слайда: игра, о которой слайд. */
export function slideCover(id: WrappedSlideId, d: WrappedResponse): { url: string | null; title: string } | null {
  const g =
    id === 'hours' || id === 'topGames' ? d.topGames.items[0]?.game
    : id === 'finished' ? (d.finished.completed.items[0] ?? d.finished.dropped.items[0])?.game
    : id === 'trophies' ? (d.trophies.platinum.rarest ?? d.trophies.platinum.last)?.game
    : id === 'longestGame' ? d.longestGame.game
    : null;
  return g ? { url: g.coverUrl, title: g.title } : null;
}
