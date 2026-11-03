// F1: границы личной оценки и заметки (контракт F1). Общие для сервера и UI.
export const RATING_MIN = 0;
export const RATING_MAX = 10;
export const NOTE_MAX = 500;
/** Длина как char_length в Postgres (кодовые точки, не UTF-16). */
export const noteLength = (s: string) => [...s].length;
/** «8/10» или null. */
export const ratingText = (r: number | null | undefined) => (r === null || r === undefined ? null : `${r}/10`);

/** Хвост имени кнопки карточки и строки: «, оценка 8 из 10» (нет оценки = пусто). */
export function ratingAria(r: number | null | undefined): string {
  return r === null || r === undefined ? '' : `, оценка ${r} из ${RATING_MAX}`;
}
