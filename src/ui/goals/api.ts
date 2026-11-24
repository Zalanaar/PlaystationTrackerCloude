// Клиент API целей месяца на главной.
import type { MonthGoalsView, ParsedGoals, RollAction, RollKind } from '@/shared/month-goals';
import { call } from '../data/http';

export const fetchMonthGoals = (signal?: AbortSignal) => call<MonthGoalsView>('/api/me/goals', { signal });
export const saveMonthGoalsApi = (body: ParsedGoals) =>
  call<MonthGoalsView>('/api/me/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const rollPlannerApi = (kind: RollKind, action: RollAction) =>
  call<MonthGoalsView>('/api/me/goals/roll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, action }) });
