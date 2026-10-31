// Недели для истории игры (контракт 26): неделя пн..вс по календарной дате МСК. Чистые функции без env/БД/сети.

/** Номер дня от 1970-01-01 для даты YYYY-MM-DD (арифметика по дате, без часового пояса). */
export const dayNumber = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

export const fromDayNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** Понедельник недели (пн..вс) для даты МСК YYYY-MM-DD. 1970-01-01 был четвергом. */
export function weekStartOf(date: string): string {
  const n = dayNumber(date);
  const dow = (((n + 3) % 7) + 7) % 7; // 0 = понедельник
  return fromDayNumber(n - dow);
}
