// П13.3: подписи цены и стоимости часа (без DOM).
import { PRICE_MAX, perHour } from '@/shared/price';
import { formatNumber } from '../format';

export { perHour };

export const rub = (n: number) => `${formatNumber(n)} ₽`;

/** «100 ₽/ч», «3,3 ₽/ч», «0 ₽/ч». */
export function perHourText(v: number): string {
  const s = Number.isInteger(v) ? formatNumber(v) : v.toFixed(1).replace('.', ',');
  return `${s} ₽/ч`;
}

/** Поле цены: пусто = null (убрать), целые рубли 0..1 000 000 (пробелы допустимы), иначе undefined. */
export function parseRubInput(s: string): number | null | undefined {
  const t = s.replace(/[\s\u00a0\u202f₽]/g, '');
  if (t === '') return null;
  if (!/^\d{1,7}$/.test(t)) return undefined;
  const n = Number(t);
  return n <= PRICE_MAX ? n : undefined;
}

/** Строка цены в окне игры: «Куплена за 3 999 ₽ · 100 ₽/ч» / «… · меньше часа сыграно» / «Бесплатно · 0 ₽/ч». */
export function priceLine(price: number, hours: number): string {
  const ph = perHour(price, hours);
  const head = price === 0 ? 'Бесплатно' : `Куплена за ${rub(price)}`;
  return `${head} · ${ph === null ? 'сыграно меньше часа' : `час стоит ${perHourText(ph)}`}`;
}
