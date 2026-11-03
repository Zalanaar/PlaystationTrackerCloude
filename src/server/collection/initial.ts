// Данные первого экрана `/` для серверного рендера (item 4, LCP): сводка 9.3 и пакет блоков 48.1 прямо из слоя БД, без HTTP к себе.
// Проверка сессии та же, что у API (requireUser: подпись, отзыв, статус входа и профиля в БД). Любая ошибка = null: клиент грузит как раньше.
import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { parseBatch, runGamesBatch } from './batch';
import { allPartsFailed, getInbox } from '@/server/inbox/query';
import { getCollectionSummary } from './query';
import type { CollectionInitial } from './types';

export const SUMMARY_URL = '/api/collection/summary';

/** Как JSON.stringify в ответе API: Date → строка, undefined пропадает. Клиент получает ровно тело ответа. */
const asJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function loadCollectionInitial(cookieHeader: string | null, batchUrl: string): Promise<CollectionInitial | null> {
  if (!cookieHeader) return null;
  try {
    const a = await requireUser(new Request('http://ssr.invalid/', { headers: { cookie: cookieHeader } }));
    if (!a.ok) return null;
    const parsed = parseBatch(new URL(batchUrl, 'http://ssr.invalid').searchParams);
    if (!parsed.ok) return null;
    const db = getDb();
    const now = new Date();
    // полоса необязательна: её сбой не мешает первому экрану (клиент догрузит сам, как раньше)
    const inboxP = getInbox(db, a.user.id, now).then((r) => (allPartsFailed(r) ? null : r), () => null);
    const [summary, batch, inbox] = await Promise.all([getCollectionSummary(db, a.user.id), runGamesBatch(db, a.user.id, parsed.value, now), inboxP]);
    if (!batch) return null;
    return {
      summaryUrl: SUMMARY_URL, summary: asJson(summary), batchUrl, batch: asJson(batch), now: Math.floor(now.getTime() / 60_000) * 60_000,
      inbox: inbox ? asJson(inbox) : null,
    };
  } catch {
    return null;
  }
}
