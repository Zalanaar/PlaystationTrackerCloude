// П13.4: клиент API «Первой недели».
import type { ChecklistResponse } from '@/server/checklist/checklist';
import { call } from '../data/http';

export const fetchChecklist = (signal?: AbortSignal) => call<ChecklistResponse>('/api/me/checklist', { signal });
export const dismissChecklistApi = () => call<{ dismissed: true }>('/api/me/checklist/dismiss', { method: 'POST' });
