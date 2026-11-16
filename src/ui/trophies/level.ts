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

/** «80% · 90 очков до 313» / «80% до 313» (без очков) / «Максимальный уровень». */
export function levelNextText(r: Pick<LevelResponse, 'level' | 'progress' | 'toNext' | 'approximate'>): string | null {
  if (r.level === null) return null;
  if (r.level >= 999) return 'Максимальный уровень';
  const pct = r.progress !== null ? `${Math.max(0, Math.min(100, r.progress))}%` : null;
  const pts = r.toNext !== null ? `${r.approximate ? '≈ ' : ''}${formatNumber(r.toNext)} ${plural(r.toNext, ['очко', 'очка', 'очков'])}` : null;
  return [pct, pts ? `${pts} до ${r.level + 1}` : `до ${r.level + 1}`].filter(Boolean).join(' · ');
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

/** Строка под полосой: прирост и прогноз. Пустые части опускаются; без истории — null. */
export function levelMeta(r: LevelResponse, today: string): string | null {
  const parts: string[] = [];
  if (r.gained) {
    const g = (n: number) => (n > 0 ? `+${n} ${plural(n, ['уровень', 'уровня', 'уровней'])}` : 'без нового уровня');
    parts.push(`За 30 дней ${g(r.gained.d30.levels)}`, `за год ${r.gained.d365.levels > 0 ? `+${r.gained.d365.levels}` : '0'}`);
  }
  if (r.eta?.next && r.level !== null) parts.push(`${r.level + 1} ≈ ${shortDate(r.eta.next, today)}`);
  if (r.eta?.milestone?.date) parts.push(`${r.eta.milestone.level} ≈ ${monthYear(r.eta.milestone.date, today)}`);
  if (r.gained && !r.eta) parts.push('за 90 дней трофеев нет — прогноза нет');
  return parts.length ? parts.join(' · ') : null;
}

export const LEVEL_EMPTY = 'Уровень PSN появится после синка';
export const LEVEL_HINT = 'Прогноз — по темпу трофеев за последние 90 дней';
