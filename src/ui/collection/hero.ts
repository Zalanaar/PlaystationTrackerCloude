// Чистая логика hero «Играю» (design-system §4.4): подписи, факты, раскладка. Без DOM и React.
import type { GameItem } from '@/server/collection/types';
import { formatDateLong, formatPlayTime, relativeAgo } from '../format';

/** В боковой колонке видно 3 карточки: больше прокручивается (§4.4). */
export const HERO_SIDE_VISIBLE = 3;

/** Трофеи показываются, только если у игры есть список (defined > 0). */
export function hasTrophyData(g: Pick<GameItem, 'trophies'>): boolean {
  return !!g.trophies && g.trophies.defined > 0;
}

/** Метка hero: «Играю» или «Играю 7» при нескольких играх (регистр делает CSS). */
export function heroLabel(count: number): string {
  return count > 1 ? `Играю ${count}` : 'Играю';
}

/** Раскладка: одна игра = hero на всю ширину, больше = hero + боковая колонка. */
export function heroLayout(total: number): { side: boolean; scrolls: boolean } {
  return { side: total > 1, scrolls: total - 1 > HERO_SIDE_VISIBLE };
}

/** «Открыть: {название}. Наиграно 128 ч, трофеи 54 из 78[, платина получена]» */
export function heroAriaLabel(g: GameItem): string {
  const time = formatPlayTime(g.playSeconds);
  const parts: string[] = [];
  if (time) parts.push(`Наиграно ${time}`);
  if (hasTrophyData(g) && g.trophies) parts.push(`трофеи ${g.trophies.earned} из ${g.trophies.defined}`);
  if (g.trophies?.platinumEarned) parts.push('платина получена');
  return parts.length ? `Открыть: ${g.title}. ${parts.join(', ')}` : `Открыть: ${g.title}`;
}

export type HeroFact = { id: 'time' | 'trophies' | 'last'; label: string; value: string; title?: string; muted: boolean };

/** Три факта hero: наиграно, трофеи (нет данных о трофеях: факт скрыт), последний запуск. */
export function heroFacts(g: GameItem, now: number): HeroFact[] {
  const time = formatPlayTime(g.playSeconds);
  const out: HeroFact[] = [{ id: 'time', label: 'Наиграно', value: time ?? 'нет данных', muted: !time }];
  if (hasTrophyData(g) && g.trophies) out.push({ id: 'trophies', label: 'Трофеи', value: `${g.trophies.earned}/${g.trophies.defined}`, muted: false });
  const ago = relativeAgo(g.lastPlayedAt, now);
  out.push({ id: 'last', label: 'Последний запуск', value: ago ?? 'нет данных', title: formatDateLong(g.lastPlayedAt) ?? undefined, muted: !ago });
  return out;
}

/** Прогресс трофеев 0..100 или null (полоса скрыта). */
export function heroProgress(g: Pick<GameItem, 'trophies'>): number | null {
  return hasTrophyData(g) && g.trophies ? Math.min(100, Math.max(0, g.trophies.progress)) : null;
}

/** Мета миниатюры: «28 ч 17 м» и «3 дн. назад» отдельными строками. */
export function miniMeta(g: GameItem, now: number): { time: string | null; ago: string | null } {
  return { time: formatPlayTime(g.playSeconds), ago: relativeAgo(g.lastPlayedAt, now) };
}
