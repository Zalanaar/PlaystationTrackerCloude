// Чистая логика экрана «Подскажи» (спека фазы 13, контракт §18). Без React и сети.
import { GENRE_LABELS_RU, type GenreKey } from '@/shared/genres';
import { formatPlayTime, plural } from '../format';

export const TIME_VALUES = ['any', 'short', 'medium', 'long'] as const;
export type TimeValue = (typeof TIME_VALUES)[number];

/** Неизвестное значение трактуется как `any` (п.7.2). */
export function parseTime(raw: string | null | undefined): TimeValue {
  return (TIME_VALUES as readonly string[]).includes(raw ?? '') ? (raw as TimeValue) : 'any';
}

export const TIME_OPTIONS: readonly { value: TimeValue; label: string; hint: string }[] = [
  { value: 'any', label: 'Любое', hint: 'без ограничения' },
  { value: 'short', label: 'Короткая', hint: 'до 8 ч' },
  { value: 'medium', label: 'Средняя', hint: '8–30 ч' },
  { value: 'long', label: 'Долгая', hint: 'более 30 ч' },
];

/** Адрес страницы: `any` в URL не пишется. */
export function recommendHref(time: TimeValue): string {
  return time === 'any' ? '/recommend' : `/recommend?time=${time}`;
}

export function timeHintText(time: TimeValue): string {
  return time === 'any' ? 'Подбираю по жанрам и истории' : 'Окно считается по оценке времени прохождения';
}

export function candidatesText(n: number): string {
  return `Из ${n} ${plural(n, ['игры', 'игр', 'игр'])} бэклога по твоей истории`;
}

/** «≈ 22 ч 30 м»; null, если часов нет. */
export function hoursText(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  return `≈ ${formatPlayTime(Math.round(hours * 3600)) ?? '1 м'}`;
}

export function hoursSourceText(src: 'manual' | 'hltb' | null): string | null {
  return src === 'hltb' ? 'HLTB' : src === 'manual' ? 'вручную' : null;
}

/** Русские подписи жанров через « · », до 3, остальное «+N». Пустой список = null. */
export function genresLine(genres: readonly string[]): string | null {
  if (!genres.length) return null;
  const labels = genres.map((g) => (g in GENRE_LABELS_RU ? GENRE_LABELS_RU[g as GenreKey] : GENRE_LABELS_RU.OTHER));
  const shown = labels.slice(0, 3).join(' · ');
  return labels.length > 3 ? `${shown} · +${labels.length - 3}` : shown;
}

const ru1 = (n: number) => Math.abs(n).toFixed(1).replace('.', ',');

/** «+2,4», «−1,0» (U+2212), «0». */
export function signedContribution(c: number): string {
  const r = Math.round(c * 10) / 10;
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${ru1(r)}`;
}

export function scoreText(score: number): string {
  return ru1(Math.round(score * 10) / 10).replace(/^/, score < 0 ? '−' : '');
}

/** Ширина полоски в %: |c| / max|c| по карточке, минимум 4% при ненулевом, 0 при нулевом. */
export function barPercent(c: number, max: number): number {
  if (!(max > 0) || c === 0) return 0;
  return Math.min(100, Math.max(4, (Math.abs(c) / max) * 100));
}

export function maxAbs(values: readonly number[]): number {
  return values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

export const SOURCE_TEXT = {
  template: { label: 'шаблон', title: 'Фраза собрана по шаблону из расчёта' },
  llm: { label: 'ИИ-формулировка', title: 'Игру выбрал расчёт по твоей истории, ИИ только переписал фразу' },
} as const;

/** Спокойная строка под сеткой по meta.llm (п.8.2). */
export function llmNote(llm: 'ok' | 'disabled' | 'limit' | 'error'): string | null {
  if (llm === 'limit') return 'Формулировки сегодня по шаблону: дневной лимит ИИ исчерпан.';
  if (llm === 'error') return 'Формулировки временно по шаблону.';
  return null;
}

export function updatedText(n: number): string {
  return `Подсказки обновлены: ${n} ${plural(n, ['игра', 'игры', 'игр'])}`;
}
