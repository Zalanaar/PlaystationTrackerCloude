// П13.2: чистая часть тегов (без DOM и React).
import type { TagDto } from '@/server/tags/tags';
import { formatNumber } from '../format';

export const TAG_NAME_MAX = 32;

export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const gamesCount = (n: number) => `${formatNumber(n)} ${plural(n, ['игра', 'игры', 'игр'])}`;

/** Ссылка на коллекцию с фильтром тега (плоский список, не хроника). */
export const tagHref = (id: number) => `/?tag=${id}`;

export function sortTags(list: readonly TagDto[]): TagDto[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) || a.id - b.id);
}

export const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim();
export const nameValid = (s: string) => { const c = cleanName(s); return c.length > 0 && [...c].length <= TAG_NAME_MAX; };
