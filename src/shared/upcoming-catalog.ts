/** Окно «предстоящие релизы»: от сегодня (YYYY-MM-DD, обычно МСК) на год вперёд. */
export const UPCOMING_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;

/** Конец окна: `from` плюс `days` календарных дней (как `dates=from,to` у RAWG). */
export function upcomingWindowEnd(from: string, days = UPCOMING_WINDOW_DAYS): string {
  const t = Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(t)) return from;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

/** Дата в окне, включая границы. Пустая/TBA — нет. */
export function inUpcomingWindow(date: string | null, from: string, to?: string): boolean {
  if (!date) return false;
  const end = to ?? upcomingWindowEnd(from);
  return date >= from && date <= end;
}

function cmpExternalId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isInteger(na) && Number.isInteger(nb) && String(na) === a && String(nb) === b) return na - nb;
  return a.localeCompare(b);
}

/** По дате выхода по возрастанию; без даты — в конце; одинаковая дата — по id каталога. */
export function sortUpcomingByDate<T extends { releaseDate: string | null; externalId: string }>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) => (a.releaseDate ?? '9999-99-99').localeCompare(b.releaseDate ?? '9999-99-99') || cmpExternalId(a.externalId, b.externalId),
  );
}
