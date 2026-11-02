import { describe, expect, it } from 'vitest';
import type { BatchResult, ManualGame } from './manual';
import {
  BATCH_MAX, addedSummaryText, applyBatch, batchErrorText, cartAdd, cartAutoOpen, cartFull, cartPayable, cartRemove, cartSetBought, cartLabel, hasNotPurchased,
  partialBannerText, toBatchItems, type CartCand, type CartEntry,
} from './cart';

const cand = (id: string, title = `Игра ${id}`): CartCand => ({ externalId: id, title, coverUrl: null, releaseDate: '2026-12-05' });
const item = (id: string, notPurchased: boolean): ManualGame => ({
  id: Number(id), source: 'manual', kind: 'ps_backlog', externalSource: 'rawg', externalId: id, title: `Игра ${id}`, coverUrl: null, releaseDate: null, status: 'backlog',
  notPurchased, matchSuggestion: null, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
});
const fill = (n: number): CartEntry[] => Array.from({ length: n }, (_, i) => i).reduce<CartEntry[]>((c, i) => cartAdd(c, cand(String(i + 1)), false), []);

describe('модель корзины', () => {
  it('игра кладётся один раз, по умолчанию «Не купил»', () => {
    const c = cartAdd(cartAdd([], cand('1'), false), cand('1'), true);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ externalId: '1', bought: false, state: 'ready' });
  });
  it('лимит пачки 10: одиннадцатая игра не добавляется', () => {
    const c = fill(BATCH_MAX);
    expect(cartFull(c)).toBe(true);
    expect(cartAdd(c, cand('99'), false)).toHaveLength(BATCH_MAX);
    expect(cartFull(cartRemove(c, '1'))).toBe(false);
  });
  it('смена «Купил / Не купил» обновляет только выбранную игру', () => {
    const c = cartSetBought(fill(2), '2', true);
    expect(c.map((e) => e.bought)).toEqual([false, true]);
  });
  it('дубли ждут решения и не входят в счётчик «Добавить N»', () => {
    const c = fill(3).map((e, i) => (i === 1 ? { ...e, state: 'duplicate' as const } : e));
    expect(cartPayable(c).map((e) => e.externalId)).toEqual(['1', '3']);
  });
  it('тела пачки: notPurchased отправляется явно, confirmDuplicate только по запросу', () => {
    const c = cartSetBought(fill(2), '2', true);
    const b = toBatchItems(c);
    expect(b[0]).toEqual({ externalSource: 'rawg', externalId: '1', title: 'Игра 1', coverUrl: null, releaseDate: '2026-12-05', notPurchased: true });
    expect(b[1].notPurchased).toBe(false);
    expect(b.some((x) => 'confirmDuplicate' in x)).toBe(false);
    expect(toBatchItems(c, true).every((x) => x.confirmDuplicate === true)).toBe(true);
  });
  it('подписи: счётчик, автораскрытие', () => {
    expect(cartLabel(4)).toBe('К добавлению: 4');
    expect(cartLabel(4, true)).toBe('Выбрано: 4');
    expect(cartAutoOpen(3, false)).toBe(true);
    expect(cartAutoOpen(4, false)).toBe(false);
    expect(cartAutoOpen(2, true)).toBe(false);
    expect(cartAutoOpen(0, false)).toBe(false);
  });
});

describe('разбор ответа пакета', () => {
  const sent = [cartSetBought(fill(5), '2', true)][0];
  const results: BatchResult[] = [
    { index: 0, externalId: '1', status: 'created', item: item('1', true) },
    { index: 1, externalId: '2', status: 'created', item: item('2', false) },
    { index: 2, externalId: '3', status: 'exists', item: item('3', true) },
    { index: 3, externalId: '4', status: 'duplicate', code: 'duplicate_game', details: { duplicate: 'library', game: { gameId: 7, name: 'Игра PSN', imageUrl: null }, planned: null } },
    { index: 4, externalId: '5', status: 'error', code: 'manual_limit' },
  ];
  it('созданные и «уже было» уходят из корзины, дубль и ошибка остаются', () => {
    const a = applyBatch(sent, sent, results);
    expect(a.cart.map((e) => [e.externalId, e.state])).toEqual([['4', 'duplicate'], ['5', 'error']]);
    expect(a.partial).toBe(true);
    expect(a.created).toBe(2);
    expect(a.counted).toBe(4); // «уже было» в знаменатель не входит
    expect(a.outcomes['1']).toEqual({ kind: 'added', bought: false, title: 'Игра 1' });
    expect(a.outcomes['2']).toEqual({ kind: 'added', bought: true, title: 'Игра 2' });
    expect(a.outcomes['3']).toEqual({ kind: 'already' });
    expect(a.cart[0].dup?.game?.name).toBe('Игра PSN');
    expect(a.cart[1].error).toBe(batchErrorText('manual_limit'));
    expect(a.cart[1].error).toContain('200');
  });
  it('все добавлены: корзина пуста, не частичный успех', () => {
    const ok: BatchResult[] = sent.map((e, i) => ({ index: i, externalId: e.externalId, status: 'created', item: item(e.externalId, !e.bought) }));
    const a = applyBatch(sent, sent, ok);
    expect(a.cart).toEqual([]);
    expect(a.partial).toBe(false);
    expect(a.created).toBe(5);
  });
  it('элемент без ответа считается ошибкой и остаётся; игры вне пачки не трогаются', () => {
    const a = applyBatch(sent, sent.slice(0, 2), [results[0]]);
    expect(a.cart.map((e) => [e.externalId, e.state])).toEqual([['2', 'error'], ['3', 'ready'], ['4', 'ready'], ['5', 'ready']]);
    expect(a.cart[0].error).toBe('Не удалось добавить. Повтори.');
  });
  it('db_unavailable: общий текст, повтор без confirmDuplicate', () => {
    const a = applyBatch(sent.slice(0, 1), sent.slice(0, 1), [{ index: 0, externalId: '1', status: 'error', code: 'db_unavailable' }]);
    expect(a.cart[0].error).toBe('Не удалось добавить. Повтори.');
  });
  it('повтор пачки: все exists', () => {
    const again = applyBatch(sent.slice(0, 2), sent.slice(0, 2), sent.slice(0, 2).map((e, i) => ({ index: i, externalId: e.externalId, status: 'exists' as const, item: item(e.externalId, true) })));
    expect(again.cart).toEqual([]);
    expect(again.created).toBe(0);
    expect(again.counted).toBe(0);
  });
});

describe('тексты', () => {
  it('баннер частичного успеха', () => expect(partialBannerText(2, 5)).toBe('Добавлено 2 из 5. Остальные: исправь или убери.'));
  it('тост: одна игра, несколько, с купленными', () => {
    expect(addedSummaryText([{ title: 'Hades II', bought: false }])).toBe('Добавлено в бэклог: «Hades II»');
    expect(addedSummaryText([{ title: 'a', bought: false }, { title: 'b', bought: false }])).toBe('Добавлено в бэклог: 2');
    expect(addedSummaryText(Array.from({ length: 5 }, (_, i) => ({ title: String(i), bought: i < 2 })))).toBe('Добавлено в бэклог: 5, из них куплено: 2');
  });
  it('«Показать» только когда среди добавленных есть «Не куплено»', () => {
    expect(hasNotPurchased([{ bought: true }])).toBe(false);
    expect(hasNotPurchased([{ bought: true }, { bought: false }])).toBe(true);
  });
});

describe('exists и выбор «Купил» (QA-43.1-2)', () => {
  const one = (bought: boolean, existingNotPurchased: boolean) => {
    const c = cartAdd([], cand('7'), bought);
    return applyBatch(c, c, [{ index: 0, externalId: '7', status: 'exists', item: item('7', existingNotPurchased) }]);
  };
  it('«Купил» для записи «не куплено»: нужен вызов /purchased по id записи', () => {
    expect(one(true, true).toPurchase).toEqual([{ externalId: '7', id: 7, title: 'Игра 7' }]);
  });
  it('совпадающий выбор или «Не купил»: вызов не нужен', () => {
    expect(one(true, false).toPurchase).toEqual([]);
    expect(one(false, true).toPurchase).toEqual([]);
    expect(one(false, false).toPurchase).toEqual([]);
  });
});
