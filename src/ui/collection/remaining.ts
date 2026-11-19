// Модель блока «осталось ≈ N ч» (Фаза 32, спека docs/design/phase-32-remaining-goal.md, п.1). Чистые функции, остаток UI не считает.
import type { GameDuration } from '@/server/collection/types';
import { formatHours, formatHoursApprox } from '../format';

/** Потолок заливки при сработавшем минимуме 15% (полоса не доходит до конца). */
export const MINIMUM_PROGRESS = 0.85;

/** F28: «≈ 45 м», «≈ 2 ч 30 м», «≈ 12 ч» (formatHoursApprox: до 10 ч часы и минуты, дальше целые). */
export function formatRemaining(h: number): string {
  return `≈ ${formatHoursApprox(h)}`;
}

/** Наиграно, без «≈» (для tooltip «Наиграно 8 ч 10 м из ≈ 20 ч»). */
export function plainHours(h: number): string {
  return formatHours(h);
}

export type RemainingKind =
  | 'remaining'   // A, B, D, E, F: известен остаток
  | 'total'       // H: остаток не посчитан, показываем полную длительность
  | 'notFound'    // C: часов нет, на HLTB не найдено
  | 'unknown'     // часов нет, HLTB не проверялся
  | 'none';

export type RemainingView = {
  kind: RemainingKind;
  /** Текст часов: «≈ 12 ч». */
  text: string | null;
  /** Слово «осталось» нужно только при известном остатке. */
  hasWord: boolean;
  /** Доля заливки 0..1 или null (полосы нет). */
  fill: number | null;
  isMinimum: boolean;
  source: GameDuration['source'];
  /** Метка источника или пометка минимума. */
  sourceText: string | null;
  notOnHltb: boolean;
  /** title и дополнение к aria-label. */
  hint: string | null;
  /** aria-label полосы и общей строки. */
  label: string;
  /** Целое % для aria-valuenow. */
  percent: number | null;
};

/**
 * Остаток и доля берутся из `duration.remainingHours` / `duration.progress`. Минимум 15% распознаётся по progress >= 0.85
 * (backend не присылает отдельный флаг). `playedSeconds` нужен только для подсказки «Наиграно X из Y».
 */
export function remainingView(d: GameDuration | undefined, playedSeconds?: number | null): RemainingView {
  const notOnHltb = d?.hltb.status === 'not_found';
  const source = d?.source ?? null;
  const base = { source, notOnHltb, isMinimum: false, sourceText: null as string | null, hint: null as string | null, percent: null as number | null, fill: null as number | null };
  if (!d || d.hours === null) {
    if (notOnHltb) return { ...base, kind: 'notFound', text: null, hasWord: false, label: 'Длительность неизвестна: игры нет на HLTB' };
    return { ...base, kind: 'unknown', text: null, hasWord: false, label: 'Длительность неизвестна' };
  }
  const srcWord = source === 'manual' ? 'вручную' : source === 'hltb' ? 'HLTB' : null;
  // F24: в строках видно только «вручную»; HLTB — источник по умолчанию, он назван один раз в подписи блока (в aria-label остаётся)
  const shownSrc = source === 'manual' ? 'вручную' : null;
  const rem = d.remainingHours;
  const prog = d.progress;
  if (rem === undefined || rem === null || prog === undefined || prog === null) {
    // H: остаток не известен синку, не выдумываем
    return { ...base, kind: 'total', text: formatRemaining(d.hours), hasWord: false, sourceText: shownSrc, label: `Длительность ${formatRemaining(d.hours)}${srcWord ? `, ${srcWord}` : ''}` };
  }
  const isMinimum = prog >= MINIMUM_PROGRESS;
  const fill = isMinimum ? Math.min(prog, MINIMUM_PROGRESS) : Math.min(1, Math.max(0, prog));
  const played = typeof playedSeconds === 'number' && playedSeconds > 0 ? playedSeconds / 3600 : null;
  const text = formatRemaining(rem);
  let hint: string | null;
  if (isMinimum) hint = 'Игра идёт дольше оценки HLTB. Показан минимум 15% оценки.';
  else if (source === 'manual') hint = 'Оценка введена вручную';
  else hint = played !== null ? `Наиграно ${plainHours(played)} из ${formatRemaining(d.hours)}` : `Полная длительность ${formatRemaining(d.hours)}`;
  const playedPart = played !== null ? `Наиграно ${plainHours(played)} из ≈ ${formatHoursApprox(d.hours)}, ` : '';
  const label = `${playedPart}осталось ${text}${isMinimum ? ', минимум 15%' : source === 'manual' ? ', оценка вручную' : srcWord ? `, ${srcWord}` : ''}`;
  return {
    kind: 'remaining', text, hasWord: true, fill: fill > 0 ? fill : 0, isMinimum, source,
    sourceText: isMinimum ? 'мин. 15%' : shownSrc, notOnHltb, hint, label, percent: Math.round(fill * 100),
  };
}
