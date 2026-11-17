// П13.1 «Достижения»: названия, условия, значки и подписи состояния (без DOM и React).
import type { Achievement, AchievementId } from '@/server/achievements/achievements';
import { formatDate, formatNumber } from '../format';
import type { IconName } from '../icons';

export const ACH_META: Readonly<Record<AchievementId, { title: string; text: string; icon: IconName }>> = {
  completed_1: { title: 'Первая пройденная', text: 'Пройди первую игру', icon: 'check-circle' },
  completed_10: { title: 'Десятка', text: 'Пройди 10 игр', icon: 'check-circle' },
  completed_50: { title: 'Полсотни', text: 'Пройди 50 игр', icon: 'check-circle' },
  platinum_1: { title: 'Первая платина', text: 'Получи платиновый трофей', icon: 'trophy' },
  platinum_10: { title: 'Платиновая полка', text: 'Получи 10 платин', icon: 'trophy' },
  trophies_1000: { title: 'Тысяча трофеев', text: 'Получи 1000 трофеев', icon: 'trophy' },
  ultra_rare: { title: 'Ультраредкий', text: 'Трофей, который есть меньше чем у 1% игроков', icon: 'sparkles' },
  hours_100: { title: 'Сто часов', text: 'Наиграй 100 часов', icon: 'timer' },
  hours_1000: { title: 'Тысяча часов', text: 'Наиграй 1000 часов', icon: 'timer' },
  marathon: { title: 'Марафон', text: '100 часов в одной игре', icon: 'flame' },
  genres_5: { title: 'Разносторонний', text: 'Пройди игры пяти жанров', icon: 'grid' },
  critic_10: { title: 'Критик', text: 'Оцени 10 игр', icon: 'pencil' },
};

/** Подпись состояния: «Получено 18.03.2025 · Elden Ring», «Получено», «7 из 10», «120 из 1 000 ч». */
export function achState(a: Achievement): string {
  if (a.unlocked) {
    const d = formatDate(a.at);
    const head = d ? `Получено ${d}` : 'Получено';
    return a.detail ? `${head} · ${a.detail}` : head;
  }
  const unit = a.id.startsWith('hours_') || a.id === 'marathon' ? ' ч' : '';
  return `${formatNumber(Math.min(a.value, a.target))} из ${formatNumber(a.target)}${unit}`;
}

export const achPercent = (a: Achievement): number => (a.unlocked ? 100 : Math.max(0, Math.min(99, Math.floor((a.value / a.target) * 100))));

export const achSummary = (unlocked: number, total: number): string => `${unlocked} из ${total}`;
