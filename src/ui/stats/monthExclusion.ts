// Чистая логика «Убрать из этого месяца» (спека 9.1 п.4, контракт 15.1). Без DOM и React.
import type { PlayedItem } from '@/server/stats/types';
import type { MonthExclusionResponse } from '../collection/api';
import { formatPlayTime } from '../format';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_ACC = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** «октября» для «убрана из октября». */
export const monthFrom = (m: number): string => MONTHS_GEN[m - 1] ?? '';
/** «октябрь» для «возвращена в октябрь». */
export const monthTo = (m: number): string => MONTHS_ACC[m - 1] ?? '';

/** Время для диалога и подписей: «5 ч», «40 м»; меньше минуты и нули дают «менее минуты». */
export function hoursText(hours: number): string {
  return formatPlayTime(Math.round(hours * 3600)) ?? 'менее минуты';
}

/** Измеренная и оценочная часть. Нет раздельных полей (старый ответ): оценочная игра считается целиком оценкой. */
export function splitHours(i: Pick<PlayedItem, 'hours' | 'hoursReal' | 'hoursEstimated' | 'estimated'>): { real: number; estimated: number } {
  if (i.hoursReal !== undefined || i.hoursEstimated !== undefined) return { real: i.hoursReal ?? 0, estimated: i.hoursEstimated ?? 0 };
  return i.estimated ? { real: 0, estimated: i.hours } : { real: i.hours, estimated: 0 };
}

export type ExcludePlan =
  | { kind: 'silent' }
  | { kind: 'confirm'; title: string; lines: string[] };

/**
 * Нужен ли диалог. Без измеренных часов (только оценка) убираем сразу и пишем тост;
 * с измеренными часами спрашиваем: они не двигаются, игра пропадёт только из списка (п.5.2).
 */
export function excludePlan(i: PlayedItem, monthNumber: number): ExcludePlan {
  const { real, estimated } = splitHours(i);
  if (real <= 0) return { kind: 'silent' };
  const lines = [`Измеренные часы (${hoursText(real)}) останутся в статистике месяца: они привязаны к датам снимков и не двигаются. Игра пропадёт только из списка «Игры месяца».`];
  if (estimated > 0) lines.push(`Оценочная часть (${hoursText(estimated)}) будет перераспределена по другим месяцам игры.`);
  return { kind: 'confirm', title: `Убрать из списка ${monthFrom(monthNumber)}?`, lines };
}

/** Текст тоста после успешного ответа PUT month-exclusions (excluded: true). */
export function excludedToast(r: Pick<MonthExclusionResponse, 'redistributed' | 'estimateDropped'>, monthNumber: number, hadReal: boolean): string {
  const m = monthFrom(monthNumber);
  if (hadReal) {
    const tail = r.redistributed ? 'Измеренные часы остаются, оценочная часть перераспределена по другим месяцам' : r.estimateDropped ? 'Измеренные часы остаются, оценочные часы выпали из статистики' : 'Измеренные часы остаются';
    return `Игра убрана из списка ${m}. ${tail}`;
  }
  if (r.redistributed) return `Игра убрана из ${m}. Оценочные часы перераспределены по другим месяцам`;
  if (r.estimateDropped) return `Игра убрана из ${m}. Другого месяца для оценочных часов нет, они выпали из статистики`;
  return `Игра убрана из ${m}`;
}

export const restoredToast = (monthNumber: number): string => `Игра возвращена в ${monthTo(monthNumber)}`;
export const CONFLICT_TEXT = 'Нельзя убрать игру из всех месяцев: часы некуда перераспределить.';
export const EXCLUDE_FAIL_TEXT = 'Не удалось убрать игру. Повтори';
export const RESTORE_FAIL_TEXT = 'Не удалось вернуть игру. Повтори';
export const EXCLUDE_TOAST_TTL = 8000;

/** Подпись строки «Убрано из месяца: 2». */
export const excludedLabel = (n: number): string => `Убрано из месяца: ${n}`;

/** aria-label кнопки «⋯»: «Действия: Название, октябрь». */
export const monthActionLabel = (title: string, monthNumber: number): string => `Действия: ${title}, ${monthTo(monthNumber)}`;
