// П13.3: общее для сервера и клиента — пределы цены и стоимость часа.
export const PRICE_MAX = 1_000_000;
/** Меньше часа — стоимость часа не считаем (иначе «999 ₽/ч» за 5 минут запуска). */
export const MIN_HOURS = 1;

/** Стоимость часа, ₽: целые (меньше 10 ₽ — с десятыми). null — сыграно меньше часа. */
export function perHour(price: number, hours: number): number | null {
  if (hours < MIN_HOURS) return null;
  const v = price / hours;
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
}
