// Клиент /api/me/whats-new (P2-16, контракт 23.5). Ошибки не бросаются: без сервера работает локальная отметка.
import { registerCacheReset } from '../profiles/scope';

let cache: { userId: number; p: Promise<number | null | undefined> } | null = null;
registerCacheReset(() => { cache = null; });

async function parse(res: Response): Promise<number | null | undefined> {
  if (!res.ok) return undefined; // 401, 5xx (в т.ч. миграция 0030 ещё не применена)
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: { seen?: unknown } } | null;
  const v = json?.ok ? json.data?.seen : undefined;
  return v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** Серверная отметка: число, null (не отмечал) или undefined (сервер недоступен). Один запрос на пользователя за загрузку. */
export function fetchWhatsNewSeen(userId: number): Promise<number | null | undefined> {
  if (!cache || cache.userId !== userId) {
    const p = fetch('/api/me/whats-new', { cache: 'no-store' }).then(parse).catch(() => undefined);
    cache = { userId, p };
  }
  return cache.p;
}

/** Отметить прочитанным до id (только растёт; сбой молча, локальная отметка уже стоит). */
export function saveWhatsNewSeen(userId: number, seen: number): void {
  cache = { userId, p: Promise.resolve(seen) };
  void fetch('/api/me/whats-new', {
    method: 'PUT', cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen }),
  }).catch(() => {});
}
