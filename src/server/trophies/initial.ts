// F3: первая страница ленты для SSR `/trophies` (как первый экран `/`): та же проверка сессии, что у API, без HTTP к себе.
// Любая ошибка = null: клиент загрузит сам.
import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { FEED_LIMIT } from './feed';
import { getTrophyFeed } from './feed-query';
import type { FeedPeriod, FeedResponse } from './types';

export async function loadTrophyFeedInitial(cookieHeader: string | null, period: FeedPeriod, rare: boolean): Promise<FeedResponse | null> {
  if (!cookieHeader) return null;
  try {
    const a = await requireUser(new Request('http://ssr.invalid/', { headers: { cookie: cookieHeader } }));
    if (!a.ok) return null;
    const r = await getTrophyFeed(getDb(), a.user.id, { period, rare, cursor: null, limit: FEED_LIMIT }, new Date());
    return JSON.parse(JSON.stringify(r)) as FeedResponse;
  } catch {
    return null;
  }
}
