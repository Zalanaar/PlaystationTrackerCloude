// Клиент API целей месяца на главной.
import type { MonthGoalsView, ParsedGoals } from '@/shared/month-goals';
import { call } from '../data/http';

export const fetchMonthGoals = (signal?: AbortSignal) => call<MonthGoalsView>('/api/me/goals', { signal });
export const saveMonthGoalsApi = (body: ParsedGoals) =>
  call<MonthGoalsView>('/api/me/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
