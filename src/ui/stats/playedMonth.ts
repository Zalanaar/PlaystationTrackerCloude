// Выбор месяца в блоке «Игры месяца» (docs/design-system.md §8.2). Чистая логика.

/** `?m=YYYY-MM`: формат месяца. */
export const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Какой месяц показать. Период «Месяц»: единственный. Период «Год»: из `?m=`, если такой месяц есть среди доступных,
 * иначе последний (самый поздний) месяц с играми. Нет месяцев: null.
 */
export function pickPlayedMonth(months: readonly string[], period: 'year' | 'month', param: string | null): string | null {
  if (months.length === 0) return null;
  if (period === 'month') return months[0];
  if (param && MONTH_PARAM.test(param) && months.includes(param)) return param;
  return [...months].sort().at(-1) ?? null;
}
