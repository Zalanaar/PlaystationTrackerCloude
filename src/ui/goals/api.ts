// Клиент API целей месяца на главной.
import type { MonthGoalsView } from '@/server/goals/month-goals';
import { call } from '../data/http';

export const fetchMonthGoals = (signal?: AbortSignal) => call<MonthGoalsView>('/api/me/goals', { signal });
export const saveMonthGoalsApi = (body: { games: number | null; hours: number | null; trophies: number | null }) =>
  call<MonthGoalsView>('/api/me/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
