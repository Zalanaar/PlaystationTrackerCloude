// Чистая функция без клиентских зависимостей: импортируется и сервером (страница `/`, item 4), и клиентом.

/** URL `GET /api/games/batch` (48.1): каждая выборка 9.2 отдельным параметром `b`, порядок сохраняется. */
export function gamesBatchUrl(queries: readonly URLSearchParams[]): string {
  const p = new URLSearchParams();
  for (const q of queries) p.append('b', q.toString());
  return `/api/games/batch?${p.toString()}`;
}
