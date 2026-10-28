// Чистая логика профиля PSN (design-system §4.16): подписи, правила пустоты. Без DOM и React.
import type { PsnProfile } from '@/server/collection/types';
import { formatNumber, plural } from '../format';

/** Нет профиля или ника: блок не показывается (§4.16.1). `tier` в UI не используется. */
export function usableProfile(p: PsnProfile | null | undefined): PsnProfile | null {
  return p && p.onlineId.trim() !== '' ? p : null;
}

export const clampPercent = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));

/** «Ур. 312» или null. */
export function levelText(p: Pick<PsnProfile, 'level'>): string | null {
  return p.level !== null ? `Ур. ${p.level}` : null;
}

/** «47% до 313»: нужны и уровень, и прогресс. */
export function levelProgressText(p: Pick<PsnProfile, 'level' | 'levelProgress'>): string | null {
  return p.level !== null && p.levelProgress !== null ? `${clampPercent(p.levelProgress)}% до ${p.level + 1}` : null;
}

/** Полоса прогресса уровня видна, только если есть и уровень, и процент. */
export function levelBarPercent(p: Pick<PsnProfile, 'level' | 'levelProgress'>): number | null {
  return p.level !== null && p.levelProgress !== null ? clampPercent(p.levelProgress) : null;
}

/** «Ур. 312 · 38 платин» для меню профиля; нет данных = часть опускается, пусто = null. */
export function profileLine(p: Pick<PsnProfile, 'level' | 'trophies'>): string | null {
  const parts: string[] = [];
  const lvl = levelText(p);
  if (lvl) parts.push(lvl);
  if (p.trophies) parts.push(`${formatNumber(p.trophies.platinum)} ${plural(p.trophies.platinum, ['платина', 'платины', 'платин'])}`);
  return parts.length ? parts.join(' · ') : null;
}

export type TrophyCell = { kind: 'platinum' | 'gold' | 'silver' | 'bronze'; count: number; text: string; aria: string };
const KINDS: readonly { kind: TrophyCell['kind']; label: string }[] = [
  { kind: 'platinum', label: 'Платина' }, { kind: 'gold', label: 'Золото' }, { kind: 'silver', label: 'Серебро' }, { kind: 'bronze', label: 'Бронза' },
];

/** Четыре счётчика трофеев аккаунта и «Всего 4 348»; null, если счётчиков нет. */
export function trophyCells(p: Pick<PsnProfile, 'trophies'>): { cells: TrophyCell[]; total: string } | null {
  const t = p.trophies;
  if (!t) return null;
  return {
    cells: KINDS.map(({ kind, label }) => ({ kind, count: t[kind], text: formatNumber(t[kind]), aria: `${label} ${formatNumber(t[kind])}` })),
    total: `Всего ${formatNumber(t.total)}`,
  };
}

/** Инициал для аватара-заглушки: первая буква ника в верхнем регистре, иначе «?». */
export function avatarInitial(onlineId: string | null | undefined): string {
  const c = (onlineId ?? '').trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}
