// Классификация ошибок БД при восстановлении (N-4): ошибка данных файла не равна недоступности БД.
/** Ошибка данных Postgres (класс SQLSTATE 22 или 23: нарушение CHECK, уникальности, формата), а не недоступность БД. */
export function isDataError(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && typeof cur === 'object' && i < 4; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^(22|23)[0-9A-Z]{3}$/.test(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
