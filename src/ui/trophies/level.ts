// П12.3 «Уровень PSN»: подписи блока на /trophies. Без DOM и React.
import type { LevelResponse } from '@/server/trophies/level-query';
import { formatNumber, plural } from '../format';

const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_NOM = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** Цвет значка уровня: до 100 — бронза, до 300 — серебро, до 999 — золото, 999 — платина (по ступеням PSN). */
export function levelGrade(level: number): 'bronze' | 'silver' | 'gold' | 'platinum' {
  if (level >= 999) return 'platinum';
  if (level >= 300) return 'gold';
  if (level >= 100) return 'silver';
  return 'bronze';
}

/** F21: справа от полосы — только процент («47%»); «Максимальный уровень» на 999. Очки и дата — строкой «До 313: …». */
export function levelNextText(r: Pick<LevelResponse, 'level' | 'progress'>): string | null {
  if (r.level === null) return null;
  if (r.level >= 999) return 'Максимальный уровень';
  return r.progress !== null ? `${Math.max(0, Math.min(100, r.progress))}%` : null;
}

/** F21, строка 1: «До 313: 477 очков, ≈ 14 дек.»; без прогноза — «… прогноза нет: за 90 дней трофеев нет». */
export function levelEta(r: LevelResponse, today: string): string | null {
  if (r.level === null || r.level >= 999) return null;
  const pts = r.toNext !== null ? `${r.approximate ? '≈ ' : ''}${formatNumber(r.toNext)} ${plural(r.toNext, ['очко', 'очка', 'очков'])}` : null;
  const when = r.eta?.next ? `≈ ${shortDate(r.eta.next, today)}` : r.gained && !r.eta ? 'прогноза нет: за 90 дней трофеев нет' : null;
  const tail = [pts, when].filter(Boolean).join(', ');
  return tail ? `До ${r.level + 1}: ${tail}` : null;
}

/** «14 дек.»; другой год — «14 дек. 2027». */
export function shortDate(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}
/** «март 2028» / «дек.» в этом году. */
export function monthYear(day: string, today: string): string {
  const [y, m] = day.split('-').map(Number);
  return `${MONTHS_NOM[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}

/** F21, строка 2: «За год +13 уровней · за 30 дней +1 · 400 ≈ март 2028». Без истории — null. */
export function levelMeta(r: LevelResponse, today: string): string | null {
  const parts: string[] = [];
  if (r.gained) {
    const y = r.gained.d365.levels, m = r.gained.d30.levels;
    parts.push(`За год ${y > 0 ? `+${y} ${plural(y, ['уровень', 'уровня', 'уровней'])}` : 'без нового уровня'}`, `за 30 дней ${m > 0 ? `+${m}` : '0'}`);
  }
  if (r.eta?.milestone?.date) parts.push(`${r.eta.milestone.level} ≈ ${monthYear(r.eta.milestone.date, today)}`);
  return parts.length ? parts.join(' · ') : null;
}

export const LEVEL_EMPTY = 'Уровень PSN появится после синка';
export const LEVEL_HINT = 'Прогноз — по темпу трофеев за последние 90 дней';
