// П13.4: пункты «Первой недели» из ответа API и клиентских признаков (тема, PWA). Без DOM.
import type { ChecklistResponse } from '@/server/checklist/checklist';

export type ItemId = 'sync' | 'statuses' | 'hltb' | 'theme' | 'pwa' | 'telegram';
export type Item = { id: ItemId; label: string; done: boolean };
export type ClientFlags = { themeChosen: boolean; pwaInstalled: boolean; pwaAvailable: boolean };

/** Порядок фиксированный. PWA — только если установка возможна или уже сделана (на десктопе без подсказки пункта нет). */
export function checklistItems(items: NonNullable<ChecklistResponse['items']>, c: ClientFlags): Item[] {
  const st = items.statuses;
  const list: Item[] = [
    { id: 'sync', label: items.sync ? 'Синк с PSN готов' : 'Синк с PSN', done: items.sync },
    { id: 'statuses', label: st.done ? 'Статусы расставлены' : `Расставь статусы · ${Math.min(st.count, st.goal)} из ${st.goal}`, done: st.done },
    { id: 'hltb', label: 'Время прохождения (HLTB)', done: items.hltb },
    { id: 'theme', label: 'Выбери тему', done: c.themeChosen },
    { id: 'pwa', label: 'На экран «Домой»', done: c.pwaInstalled },
    { id: 'telegram', label: 'Telegram-дайджест', done: items.telegram },
  ];
  return list.filter((i) => i.id !== 'pwa' || c.pwaInstalled || c.pwaAvailable);
}

export function progressText(list: readonly Item[]): string {
  return `${list.filter((i) => i.done).length} из ${list.length}`;
}

/** Дней до конца недели (минимум 1), для подзаголовка. */
export function daysLeft(endsAt: string | null, nowMs: number): number {
  if (!endsAt) return 0;
  return Math.max(1, Math.ceil((Date.parse(endsAt) - nowMs) / 86_400_000));
}
