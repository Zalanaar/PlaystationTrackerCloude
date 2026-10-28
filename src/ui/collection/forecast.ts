// Чистая логика секции «Путь к платине» (спека 9.1/15 п.8, контракт 14.2 и 15.3). Без DOM и React.
import type { PlatinumForecast } from '@/server/collection/types';
import { plural } from '../format';
import { formatRate, rarityLabel, raritySegments } from './trophies';

export const trophyWord = (n: number) => plural(n, ['трофей', 'трофея', 'трофеев']);

/** Подсказка у знака «≈» и текст сноски про DLC (контракт 15.3: `approximate`). */
export const APPROX_TITLE = 'Приблизительно: учитываются и трофеи DLC';
export const APPROX_NOTE = 'Приблизительно: считаем все трофеи набора, включая DLC. Если у игры есть дополнения, осталось меньше.';

/** Редкость по проценту игроков: 0 ультра-редкий (<1%), 1 (<5%), 2 (<15%), 3 обычный. null = процент неизвестен. */
export function rarityOfRate(rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return rate < 1 ? 0 : rate < 5 ? 1 : rate < 15 ? 2 : 3;
}

export type ForecastGrade = { type: 'gold' | 'silver' | 'bronze'; count: number; label: string };

export type ForecastView = {
  approximate: boolean;
  progress: number;
  /** «91%» */
  pct: string;
  /** «Прогресс к платине: 91%» (для aria-label) */
  pctAria: string;
  /** «49 из 54 трофеев (кроме платины)» */
  requiredText: string;
  /** «5 трофеев» или «остался 1 трофей» */
  remainingText: string;
  /** Осталось ровно один: акцентная подпись «Почти готово» */
  almost: boolean;
  grades: ForecastGrade[];
  hiddenText: string | null;
  metrics: { id: 'avg' | 'min' | 'plat'; label: string; value: string; sub: string; segments: number | null; empty: boolean }[];
  ratesNote: string | null;
  dlcText: string | null;
};

const GRADE_LABEL = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' } as const;

export function forecastView(f: PlatinumForecast): ForecastView {
  const total = f.remaining.total;
  const progress = Math.min(100, Math.max(0, Math.round(f.progress)));
  const grades = (['gold', 'silver', 'bronze'] as const)
    .map((type) => ({ type, count: f.remaining[type], label: `${GRADE_LABEL[type]}: ${f.remaining[type]}` }))
    .filter((g) => g.count > 0);
  const minRarity = rarityOfRate(f.minEarnedRate);
  const avg = formatRate(f.avgEarnedRate);
  const min = formatRate(f.minEarnedRate);
  const plat = formatRate(f.platinumEarnedRate);
  return {
    approximate: f.approximate === true,
    progress,
    pct: `${progress}%`,
    pctAria: `Прогресс к платине: ${progress}%`,
    requiredText: `${f.earned} из ${f.required} трофеев (кроме платины)`,
    remainingText: total === 1 ? 'остался 1 трофей' : `${total} ${trophyWord(total)}`,
    almost: total === 1,
    grades,
    hiddenText: f.remainingHidden > 0 ? `из них скрытых: ${f.remainingHidden}` : null,
    metrics: [
      { id: 'avg', label: 'Средняя редкость', value: avg ?? 'нет данных', sub: 'у оставшихся трофеев', segments: null, empty: avg === null },
      {
        id: 'min', label: 'Самый редкий', value: min ?? 'нет данных', sub: rarityLabel(minRarity) ?? '',
        segments: minRarity === null ? null : raritySegments(minRarity), empty: min === null,
      },
      { id: 'plat', label: 'Платина у игроков', value: plat ?? 'нет данных', sub: '', segments: null, empty: plat === null },
    ],
    ratesNote: total > 0 && f.ratesKnown < total ? `Процент известен у ${f.ratesKnown} из ${total} оставшихся` : null,
    dlcText: f.dlc ? `Трофеи DLC (для платины не нужны): получено ${f.dlc.earned} из ${f.dlc.required}, осталось ${f.dlc.remaining}` : null,
  };
}
