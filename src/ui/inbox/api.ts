// Клиент GET /api/inbox (docs/api-contract.md, Фаза 28). Только типы из server.
import { call } from '../collection/api';
import type { InboxResponse } from './model';

export const fetchInbox = () => call<InboxResponse>('/api/inbox');
