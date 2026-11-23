// Очередь офлайн-изменений: статус и оценка/заметка. Пишется в localStorage, при появлении сети проигрывается по порядку.
// Конфликт с синком: последнее намерение пользователя уходит на сервер; при 4xx пункт снимается.

export const QUEUE_KEY = 'ps-offline-queue';
export const QUEUE_EVENT = 'ps:offline-queue';

export type QueueItem = { id: string; at: number; method: string; url: string; body: string | null };

export function pathOf(url: string): string {
  try { return new URL(url, 'https://local.invalid').pathname; } catch { return url; }
}

export function isQueueable(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m !== 'PUT') return false;
  return /^\/api\/games\/\d+\/(status|review)$/.test(pathOf(url));
}

function samePath(a: string, b: string): boolean {
  return pathOf(a) === pathOf(b);
}

function mergeReviewBody(prev: string | null, next: string | null): string | null {
  if (!next) return prev;
  if (!prev) return next;
  try {
    const a = JSON.parse(prev) as Record<string, unknown>;
    const b = JSON.parse(next) as Record<string, unknown>;
    return JSON.stringify({ ...a, ...b });
  } catch {
    return next;
  }
}

/** Новая запись: для одного URL статуса/отзыва оставляем только последнее намерение (отзыв сливаем по полям). */
export function coalesce(items: readonly QueueItem[], next: QueueItem): QueueItem[] {
  const p = pathOf(next.url);
  if (next.method.toUpperCase() === 'PUT' && /\/status$/.test(p)) {
    return [...items.filter((x) => !(x.method.toUpperCase() === 'PUT' && samePath(x.url, next.url))), next];
  }
  if (next.method.toUpperCase() === 'PUT' && /\/review$/.test(p)) {
    const prev = items.filter((x) => x.method.toUpperCase() === 'PUT' && samePath(x.url, next.url));
    const others = items.filter((x) => !(x.method.toUpperCase() === 'PUT' && samePath(x.url, next.url)));
    return [...others, { ...next, body: mergeReviewBody(prev.at(-1)?.body ?? null, next.body) }];
  }
  return [...items, next];
}

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function defaultStore(): Store | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readQueue(store: Store | null = defaultStore()): QueueItem[] {
  if (!store) return [];
  try {
    const raw = store.getItem(QUEUE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is QueueItem => !!x && typeof x === 'object' && typeof (x as QueueItem).id === 'string' && typeof (x as QueueItem).url === 'string');
  } catch {
    return [];
  }
}

export function writeQueue(items: QueueItem[], store: Store | null = defaultStore()): void {
  if (!store) return;
  store.setItem(QUEUE_KEY, JSON.stringify(items));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}

export function enqueue(item: Omit<QueueItem, 'id' | 'at'> & { id?: string; at?: number }, store: Store | null = defaultStore()): QueueItem[] {
  const next: QueueItem = { id: item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: item.at ?? Date.now(), method: item.method, url: item.url, body: item.body };
  const items = coalesce(readQueue(store), next);
  writeQueue(items, store);
  return items;
}

export function queueSize(store: Store | null = defaultStore()): number {
  return readQueue(store).length;
}

export type FlushResult = 'ok' | 'drop' | 'retry';

/** Проигрывает очередь по порядку. retry — остановиться и оставить этот и последующие пункты. */
export async function flushQueue(send: (item: QueueItem) => Promise<FlushResult>, store: Store | null = defaultStore()): Promise<number> {
  const items = readQueue(store);
  const left: QueueItem[] = [];
  let done = 0;
  for (let i = 0; i < items.length; i++) {
    const r = await send(items[i]);
    if (r === 'retry') {
      left.push(...items.slice(i));
      break;
    }
    if (r === 'ok') done += 1;
  }
  writeQueue(left, store);
  return done;
}
