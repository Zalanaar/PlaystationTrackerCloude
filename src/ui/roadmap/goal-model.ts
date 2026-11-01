// Модель блока «Цель года» (Фаза 32, N2; контракт 17.3a). Чистые функции, расчёты делает backend, UI форматирует и выбирает состояние.
import type { GoalMode, GoalView } from '@/server/roadmap/goal';
import { plural } from '../format';
import type { IconName } from '../icons';
import { dayYearText } from './model';

export type { GoalMode, GoalView };

export const GOAL_MIN: Record<GoalMode, number> = { complete: 1, backlog_to: 0 };
export const GOAL_MAX = 1000;
/** Сколько завершённых игр нужно, чтобы темп считался достаточным для прогноза (решение: 2). */
export const GOAL_MIN_COMPLETED = 2;

export const gamesWord = (n: number): string => plural(Math.round(n), ['игра', 'игры', 'игр']);
export const gamesText = (n: number): string => `${Math.round(n)} ${gamesWord(n)}`;
/** Дробное число берёт форму «игры» (1,1 игры), целое склоняется обычно. */
const paceWord = (n: number): string => (Number.isInteger(n) ? gamesWord(n) : 'игры');
const num1 = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

/** Валидация поля N: целое число в границах режима. */
export function parseGoalCount(text: string, mode: GoalMode): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= GOAL_MIN[mode] && n <= GOAL_MAX ? n : null;
}
export const goalRangeText = (mode: GoalMode): string => `Введи целое число от ${GOAL_MIN[mode]} до ${GOAL_MAX}`;

export const goalTitle = (g: Pick<GoalView, 'mode' | 'count'>): string =>
  g.mode === 'complete' ? `Пройти ${gamesText(g.count)}` : `Бэклог до ${gamesText(g.count)}`;
export const modeLabel = (mode: GoalMode): string => (mode === 'complete' ? 'Пройти N' : 'Бэклог до N');

export function modeDescription(mode: GoalMode, year: number, count: number): string {
  return mode === 'complete'
    ? `За ${year} нужно пройти ${gamesText(count)}. Считаются игры со статусом «Пройдено» и датой в ${year}.`
    : `К 31 декабря в бэклоге должно остаться не больше ${gamesText(count)}. Считаются игры со статусом «Бэклог» сейчас.`;
}

/** Подсказка формы по вводу: «Сейчас: пройдено 7 из 12» / «Сейчас в бэклоге: 24, до цели 14 игр». */
export function goalFormHint(mode: GoalMode, count: number | null, current: number | null): string | null {
  if (current === null || count === null) return null;
  if (mode === 'complete') return `Сейчас: пройдено ${current} из ${count}${current >= count ? '. Цель уже выполнена, можно увеличить число.' : ''}`;
  return current <= count ? `Сейчас в бэклоге: ${current}. Цель уже выполнена.` : `Сейчас в бэклоге: ${current}, до цели ${gamesText(current - count)}`;
}

export type GoalStateKind = 'done' | 'ahead' | 'on_track' | 'behind' | 'no_data' | 'past_year' | 'future_year';
export type GoalState = {
  kind: GoalStateKind;
  icon: IconName | null;
  tone: 'success' | 'warning' | 'muted' | null;
  text: string;
  note: string | null;
  /** Прогноз и темп показываются только в текущем году при известном темпе. */
  showForecast: boolean;
  canEdit: boolean;
};

const yearOf = (iso: string): number => Number(iso.slice(0, 4));

/** Сколько игр завершено в году: для `complete` это `current`, для `backlog_to` оценка по темпу и прошедшим дням. */
export function completedInYear(g: GoalView): number {
  if (g.paceEmpty) return 0;
  if (g.mode === 'complete') return g.current;
  const start = Date.UTC(g.year, 0, 1);
  const days = Math.max(1, Math.floor((Date.parse(`${g.asOf}T00:00:00Z`) - start) / 86400000) + 1);
  return Math.round((g.pacePerMonth * days) / 30.44);
}

/** Состояние цели: «Отстаю/опережаю» берутся из `goal.status` и `goal.diff` (backend). */
export function goalState(g: GoalView): GoalState {
  const nowYear = yearOf(g.asOf);
  const done = g.status === 'achieved';
  if (g.year > nowYear || g.status === 'not_started') {
    return { kind: 'future_year', icon: null, tone: null, text: `Цель начнётся 1 янв. ${g.year}`, note: null, showForecast: false, canEdit: true };
  }
  if (done) {
    return { kind: 'done', icon: 'check', tone: 'success', text: 'Цель выполнена', note: goalDoneNote(g), showForecast: false, canEdit: g.year >= nowYear };
  }
  if (g.year < nowYear) {
    const text = g.mode === 'complete' ? `Итог ${g.year}: пройдено ${g.current} из ${g.count}` : `Итог ${g.year}: в бэклоге ${g.current}, цель до ${g.count}`;
    return { kind: 'past_year', icon: null, tone: null, text, note: null, showForecast: false, canEdit: false };
  }
  if (g.paceEmpty || completedInYear(g) < GOAL_MIN_COMPLETED) {
    return {
      kind: 'no_data', icon: 'info', tone: 'muted', text: 'Пока мало данных для прогноза',
      note: 'Нужно хотя бы 2 пройденные игры в этом году.', showForecast: false, canEdit: true,
    };
  }
  const amount = Math.max(1, Math.round(Math.abs(g.diff)));
  if (g.status === 'ahead') return { kind: 'ahead', icon: 'arrow-up', tone: 'success', text: `Опережаю на ${gamesText(amount)}`, note: null, showForecast: true, canEdit: true };
  if (g.status === 'behind') {
    return { kind: 'behind', icon: 'arrow-down', tone: 'warning', text: `Отстаю на ${gamesText(amount)}`, note: null, showForecast: true, canEdit: true };
  }
  return { kind: 'on_track', icon: 'check', tone: 'success', text: 'Успеваю', note: null, showForecast: true, canEdit: true };
}

function goalDoneNote(g: GoalView): string | null {
  return g.mode === 'complete' && g.current > g.count ? 'Цель уже перевыполнена. Можно увеличить число.' : null;
}

/** Доля полосы 0..100: `complete` current/N; `backlog_to` N/current (без доли сокращения, backend не отдаёт startBacklog). */
export function goalBarPercent(g: Pick<GoalView, 'mode' | 'count' | 'current'>): number {
  if (g.mode === 'complete') return g.count <= 0 ? 0 : Math.min(100, Math.round((g.current / g.count) * 100));
  if (g.current <= g.count) return 100;
  return Math.min(100, Math.round((g.count / g.current) * 100));
}

export function goalBarLabel(g: Pick<GoalView, 'mode' | 'count' | 'current'>): string {
  return g.mode === 'complete'
    ? `Пройдено ${g.current} из ${g.count}`
    : `В бэклоге ${g.current}, цель: не больше ${g.count}`;
}

/** Метрики: подписи и значения. */
export function goalMetrics(g: GoalView): { label: string; value: string }[] {
  return g.mode === 'complete'
    ? [{ label: 'Пройдено', value: String(g.current) }, { label: 'Цель', value: String(g.count) }]
    : [{ label: 'В бэклоге', value: String(g.current) }, { label: 'Цель', value: `≤ ${g.count}` }];
}

/** Строка прогноза: «К 31 дек. по твоему темпу: ≈ 14 игр. Нужно: 12.» */
export function goalForecastText(g: GoalView): string {
  return g.mode === 'complete'
    ? `К 31 дек. по твоему темпу: ≈ ${gamesText(g.forecastAtYearEnd)}. Нужно: ${g.count}.`
    : `К 31 дек. по твоему темпу в бэклоге будет ≈ ${g.forecastAtYearEnd}. Нужно: не больше ${g.count}.`;
}
export const goalPaceText = (g: GoalView): string => `Темп: ${num1(g.pacePerMonth)} ${paceWord(g.pacePerMonth)} в месяц`;
export const goalRequiredText = (g: GoalView): string | null =>
  g.requiredPerMonth > 0 ? `Чтобы успеть, нужно ≈ ${num1(g.requiredPerMonth)} ${paceWord(g.requiredPerMonth)} в месяц` : null;
export const goalAsOfText = (g: GoalView): string => `Темп считается по датам завершения игр в ${g.year}. Данные на ${dayYearText(g.asOf)}.`;

/** Тексты ошибок сохранения цели. */
export function goalSaveError(status: number, code: string): { text: string; settings: boolean } {
  if (status === 409 || code === 'settings_required') return { text: 'Сначала сохрани настройки плана: год и часов в неделю. Потом поставь цель.', settings: true };
  if (status === 400) return { text: 'Сервер отклонил число. Проверь значение.', settings: false };
  if (status === 503) return { text: 'База данных недоступна. Повтори позже.', settings: false };
  if (status === 401) return { text: 'Сессия истекла. Войди заново.', settings: false };
  return { text: 'Не удалось сохранить цель. Повтори', settings: false };
}
