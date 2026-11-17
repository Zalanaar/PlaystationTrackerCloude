// П13.3: клиент API цены и сводки стоимости часа.
import type { CostStats } from '@/server/prices/prices';
import { ApiError, cachedGet, call } from '../data/http';

export const fetchGamePrice = (gameId: number, signal?: AbortSignal) => call<{ price: number | null }>(`/api/games/${gameId}/price`, { signal });
export const putGamePrice = (gameId: number, price: number | null) =>
  call<{ price: number | null }>(`/api/games/${gameId}/price`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price }) });
export const fetchCost = (signal?: AbortSignal) => cachedGet<CostStats>('/api/stats/cost', signal);

export function priceErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 400) return 'Цена — целое число рублей до 1 000 000.';
    if (e.status === 404) return 'Игра не найдена. Обнови страницу.';
    if (e.status === 401) return 'Сессия истекла. Войди заново.';
  }
  return 'Нет связи с сервером.';
}
