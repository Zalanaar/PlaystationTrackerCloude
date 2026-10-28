// Чистая логика блока «Ближе всего к платине» (спека Фазы 15 п.8, контракт 14.2).
import type { NearPlatinumItem, PlatinumForecast } from '@/server/collection/types';
import { plural } from '../format';
import { formatRate } from './trophies';

/** До миграции group_id (15.3) прогноз приблизительный из-за DLC: «≈» по умолчанию. Сервер с `approximate: false` снимает знак. */
export const FORECAST_APPROX = true;
export const APPROX_HINT = 'Приблизительно: учитываются и трофеи DLC';
export const NEAR_LIMIT = 5;

export const isApproximate = (f: Pick<PlatinumForecast, 'approximate'>): boolean => f.approximate ?? FORECAST_APPROX;

export const trophiesWord = (n: number) => `${n} ${plural(n, ['трофей', 'трофея', 'трофеев'])}`;

/** Список из сводки: старый ответ без поля и мусор дают пустой список. */
export function nearItems(raw: readonly NearPlatinumItem[] | undefined | null): NearPlatinumItem[] {
  return Array.isArray(raw) ? raw.filter((x) => x && x.game && x.forecast).slice(0, NEAR_LIMIT) : [];
}

/** Блок показывается только на «чистой» коллекции: без поиска, статуса, «Платины», нестандартной сортировки и режима выбора. */
export function nearVisible(a: { count: number; chronicle: boolean; status: string; q: string; platinum: boolean; selectMode: boolean; hidden?: boolean }): boolean {
  return a.count > 0 && a.chronicle && a.status === 'all' && a.q.trim() === '' && !a.platinum && !a.selectMode && !a.hidden;
}

/** «ср. редкость 12,4%» / «редкость неизвестна». */
export function avgRarityText(f: Pick<PlatinumForecast, 'avgEarnedRate'>): string {
  const r = formatRate(f.avgEarnedRate);
  return r ? `ср. редкость ${r}` : 'редкость неизвестна';
}

export function nearAria(title: string, f: PlatinumForecast): string {
  return `${title}. Прогресс к платине${isApproximate(f) ? ' примерно' : ''} ${f.progress}%, осталось ${trophiesWord(f.remaining.total)}`;
}

/** Остаток по грейдам без нулевых, в порядке золото, серебро, бронза. */
export function remainingGrades(f: Pick<PlatinumForecast, 'remaining'>): { grade: 'gold' | 'silver' | 'bronze'; word: string; n: number }[] {
  const r = f.remaining;
  return ([['gold', 'Золото', r.gold], ['silver', 'Серебро', r.silver], ['bronze', 'Бронза', r.bronze]] as const)
    .filter(([, , n]) => n > 0)
    .map(([grade, word, n]) => ({ grade, word, n }));
}

/** Сводная пометка блока: есть ли среди карточек приблизительные. */
export const anyApproximate = (items: readonly NearPlatinumItem[]) => items.some((i) => isApproximate(i.forecast));
