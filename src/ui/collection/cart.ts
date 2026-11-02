// Чистая логика Фазы 43.1: «корзина» мультидобавления (design-system §19b.3, контракт 43.1.2). Без React и сети.
import type { BatchResult, DuplicateInfo, SearchCandidate } from './manual';
import { manualErrorText, truncate } from './manual';

/** Лимит пачки (контракт 43.1.2, MANUAL_BATCH_MAX на сервере). */
export const BATCH_MAX = 10;

export type CartCand = Pick<SearchCandidate, 'externalId' | 'title' | 'coverUrl' | 'releaseDate'>;

export type CartEntry = CartCand & {
  /** false = «Не купил» (по умолчанию), true = «Купил» */
  bought: boolean;
  state: 'ready' | 'duplicate' | 'error';
  dup?: DuplicateInfo;
  error?: string;
};

export const cartHas = (cart: readonly CartEntry[], id: string): boolean => cart.some((e) => e.externalId === id);
export const cartFull = (cart: readonly CartEntry[]): boolean => cart.length >= BATCH_MAX;
export const cartFind = (cart: readonly CartEntry[], id: string): CartEntry | undefined => cart.find((e) => e.externalId === id);

/** Положить игру в корзину; повтор и переполнение (10) ничего не меняют. */
export function cartAdd(cart: readonly CartEntry[], c: CartCand, bought: boolean): CartEntry[] {
  if (cartHas(cart, c.externalId) || cartFull(cart)) return [...cart];
  return [...cart, { externalId: c.externalId, title: c.title, coverUrl: c.coverUrl, releaseDate: c.releaseDate, bought, state: 'ready' }];
}

export const cartRemove = (cart: readonly CartEntry[], id: string): CartEntry[] => cart.filter((e) => e.externalId !== id);

/** Смена «Купил / Не купил» у выбранной игры обновляет корзину. */
export const cartSetBought = (cart: readonly CartEntry[], id: string, bought: boolean): CartEntry[] =>
  cart.map((e) => (e.externalId === id ? { ...e, bought } : e));

/** Сколько игр уйдёт по кнопке «Добавить N»: дубли ждут решения и в счётчик не входят. */
export const cartPayable = (cart: readonly CartEntry[]): CartEntry[] => cart.filter((e) => e.state !== 'duplicate');

export type BatchItemBody = {
  externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; releaseDate: string | null; notPurchased: boolean; confirmDuplicate?: boolean;
};

/** Тела элементов пачки. notPurchased отправляется всегда явно. */
export function toBatchItems(entries: readonly CartEntry[], confirmDuplicate = false): BatchItemBody[] {
  return entries.map((e) => ({
    externalSource: 'rawg', externalId: e.externalId, title: e.title, coverUrl: e.coverUrl, releaseDate: e.releaseDate, notPurchased: !e.bought,
    ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
  }));
}

export type RowOutcome = { kind: 'added'; bought: boolean; title: string } | { kind: 'already' } | { kind: 'marked'; title: string };

/** Запись уже была «Не куплено», а в корзине выбрано «Купил»: нужен POST /purchased по id записи (контракт: флаг меняется только им). */
export type PurchaseTodo = { externalId: string; id: number; title: string };

export type BatchApplied = {
  cart: CartEntry[];
  /** исходы по externalId для строк результатов */
  outcomes: Record<string, RowOutcome>;
  created: number;
  /** сколько отправлено без учёта «уже было» (знаменатель «Добавлено M из N») */
  counted: number;
  /** в корзине остались неудавшиеся */
  partial: boolean;
  /** «Купил» для уже существующих записей с пометкой «не куплено» */
  toPurchase: PurchaseTodo[];
};

export function batchErrorText(code: string): string {
  return code === 'manual_limit' ? manualErrorText({ status: 409, code: 'manual_limit' }, '') : 'Не удалось добавить. Повтори.';
}

/**
 * Применить ответ пакета к корзине (контракт 43.1.2). `sent` — элементы в порядке отправки, results[i] соответствует sent[i].
 * created/exists уходят из корзины, duplicate остаётся с блоком решения, error остаётся с текстом. Нет ответа по элементу = ошибка.
 */
export function applyBatch(cart: readonly CartEntry[], sent: readonly CartEntry[], results: readonly BatchResult[]): BatchApplied {
  const byIndex = new Map<number, BatchResult>();
  for (const r of results) if (Number.isInteger(r.index) && r.index >= 0 && r.index < sent.length) byIndex.set(r.index, r);
  const outcomes: Record<string, RowOutcome> = {};
  const patch = new Map<string, CartEntry | null>();
  let created = 0;
  let already = 0;
  const toPurchase: PurchaseTodo[] = [];
  sent.forEach((e, i) => {
    const r = byIndex.get(i);
    if (!r) { patch.set(e.externalId, { ...e, state: 'error', error: batchErrorText('') }); return; }
    if (r.status === 'duplicate') patch.set(e.externalId, { ...e, state: 'duplicate', dup: r.details, error: undefined });
    else if (r.status === 'error') patch.set(e.externalId, { ...e, state: 'error', error: batchErrorText(r.code), dup: undefined });
    else if (r.status === 'created') { created++; outcomes[e.externalId] = { kind: 'added', bought: !r.item.notPurchased, title: e.title }; patch.set(e.externalId, null); }
    else {
      already++;
      outcomes[e.externalId] = { kind: 'already' };
      if (e.bought && r.item.notPurchased) toPurchase.push({ externalId: e.externalId, id: r.item.id, title: e.title });
      patch.set(e.externalId, null);
    }
  });
  const next: CartEntry[] = [];
  for (const e of cart) {
    if (!patch.has(e.externalId)) { next.push(e); continue; }
    const p = patch.get(e.externalId);
    if (p) next.push(p);
  }
  return { cart: next, outcomes, created, counted: sent.length - already, partial: next.length > 0, toPurchase };
}

/** Баннер частичного успеха (§19b.3). */
export const partialBannerText = (created: number, counted: number): string => `Добавлено ${created} из ${counted}. Остальные: исправь или убери.`;

/** Подпись свёрнутой корзины. */
export const cartLabel = (n: number, short = false): string => (short ? `Выбрано: ${n}` : `К добавлению: ${n}`);

/** Корзина раскрыта сама: пока в ней не больше 3 игр и не было результата отправки; после частичного успеха раскрывается (§19b.3). */
export const cartAutoOpen = (n: number, hadResult: boolean): boolean => n > 0 && n <= 3 && !hadResult;

/** Тост при закрытии панели: «Добавлено в бэклог: «X»» / «… : 5, из них куплено: 2». */
export function addedSummaryText(items: readonly { title: string; bought: boolean }[]): string {
  if (items.length === 1) return `Добавлено в бэклог: «${truncate(items[0].title)}»`;
  const k = items.filter((i) => i.bought).length;
  return k > 0 ? `Добавлено в бэклог: ${items.length}, из них куплено: ${k}` : `Добавлено в бэклог: ${items.length}`;
}

/** Есть ли среди добавленных «Не куплено» (тогда в тосте действие «Показать»). */
export const hasNotPurchased = (items: readonly { bought: boolean }[]): boolean => items.some((i) => !i.bought);

/** Текст ответа живой области после отправки. */
export const addedLiveText = (n: number): string => `Добавлено: ${n}`;
