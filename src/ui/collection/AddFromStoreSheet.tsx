'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import '../recommend.css';
import { Icon } from '../icons';
import { formatDayMonth } from '../format';
import { Sheet } from '../primitives/Sheet';
import { addManualBatch, searchManual } from './manualApi';
import { AddCart } from './AddCart';
import { BuySegment } from './BuySegment';
import { Cover } from './Cover';
import {
  MAX_QUERY, MAX_RESULTS, canSearch, classifySearchError, normalizeQuery, platformsText, searchReleaseText,
  type SearchCandidate, type SearchFailure,
} from './manual';
import {
  BATCH_MAX, addedLiveText, applyBatch, cartAdd, cartAutoOpen, cartFind, cartFull, cartPayable, cartRemove, cartSetBought, partialBannerText, toBatchItems,
  type CartEntry, type RowOutcome,
} from './cart';
import { catalogGuard, useOnline } from './useSuggest';

type Phase = 'initial' | 'loading' | 'results' | 'noresults' | 'unavailable';

/** Итог сессии панели для тоста: что добавлено и «Купил» или «Не купил». */
export type AddedItem = { title: string; bought: boolean };

const initialFailure = (): SearchFailure | null => {
  const g = catalogGuard.status();
  return g.quota ? { kind: 'quota', resetAt: g.quotaResetAt } : null;
};

/**
 * Панель «Добавить из магазина PS» (design-system §19.4, §19b): запрос по Enter или «Найти», «Купил / Не купил» у каждой игры,
 * «+» выбирает в корзину, «Добавить N» отправляет пачку (POST /api/manual-games/batch). Грузится лениво.
 */
export function AddFromStoreSheet({ onClose, initialQuery }: { onClose: (added: AddedItem[]) => void; initialQuery?: string }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [phase, setPhase] = useState<Phase>('initial');
  const [results, setResults] = useState<SearchCandidate[]>([]);
  const [failure, setFailure] = useState<SearchFailure | null>(initialFailure);
  const [done, setDone] = useState<Record<string, RowOutcome>>({});
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [openPref, setOpenPref] = useState<boolean | null>(null);
  const [hadResult, setHadResult] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [live, setLive] = useState('');
  const addedRef = useRef<AddedItem[]>([]);
  const cartRef = useRef<CartEntry[]>([]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const hintId = useId();
  const confirmId = useId();
  const quotaRef = useRef<HTMLDivElement>(null);
  const online = useOnline();

  useEffect(() => () => ctl.current?.abort(), []);

  const quota = failure?.kind === 'quota';
  const ok = canSearch(q);
  // поле и «Найти» выключаются: фокус не должен упасть на body (Esc перестал бы работать), переносим на баннер
  useEffect(() => { if (quota) quotaRef.current?.focus(); }, [quota]);
  useEffect(() => { if (confirming) backRef.current?.focus(); }, [confirming]);

  const search = useCallback(async (query: string) => {
    const text = normalizeQuery(query);
    if (!canSearch(text)) return;
    const g = catalogGuard.status();
    if (g.quota) { setFailure({ kind: 'quota', resetAt: g.quotaResetAt }); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFailure({ kind: 'offline' });
      return;
    }
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const my = ++seq.current;
    setAsked(text);
    setPhase('loading');
    setFailure(null);
    try {
      const r = await searchManual(text, c.signal);
      if (my !== seq.current) return;
      const list = r.candidates.slice(0, MAX_RESULTS);
      setResults(list);
      setChoice({}); // по умолчанию снова «Не купил»; у выбранных игр значение живёт в корзине
      setDone((d) => {
        const next = { ...d };
        for (const x of list) if (x.inBacklog && !next[x.externalId]) next[x.externalId] = { kind: 'already' };
        return next;
      });
      setPhase(list.length > 0 ? 'results' : 'noresults');
      setLive(list.length > 0 ? `Найдено ${list.length} ${list.length === 1 ? 'игра' : 'игр'}` : 'Ничего не найдено');
    } catch (e) {
      if (my !== seq.current || c.signal.aborted) return;
      const f = classifySearchError(e, typeof navigator === 'undefined' || navigator.onLine !== false);
      if (f.kind === 'quota') catalogGuard.quota(f.resetAt);
      setFailure(f);
      // каталог не настроен: отдельный экран; остальные сбои не стирают прежние результаты
      setPhase((p) => (f.kind === 'unavailable' ? 'unavailable' : p === 'loading' ? (results.length > 0 ? 'results' : 'initial') : p));
    }
  }, [results.length]);

  // открытие с запросом из подсказки («Все результаты в магазине PS», Enter при мягком пределе): явный поиск сразу
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initialQuery) return;
    started.current = true;
    const t = setTimeout(() => { setQ(initialQuery); void search(initialQuery); }, 0);
    return () => { clearTimeout(t); started.current = false; };
  }, [initialQuery, search]);

  function clear() {
    setQ('');
    inputRef.current?.focus();
  }
  function reset() {
    seq.current++;
    ctl.current?.abort();
    setQ('');
    setAsked('');
    setPhase('initial');
    setResults([]);
    setFailure(null);
    inputRef.current?.focus();
  }

  // ---------- корзина ----------
  const full = cartFull(cart);
  const cartExpanded = openPref ?? cartAutoOpen(cart.length, hadResult);
  function setBought(c: SearchCandidate, bought: boolean) {
    if (cartFind(cart, c.externalId)) setCart((l) => cartSetBought(l, c.externalId, bought));
    else setChoice((m) => ({ ...m, [c.externalId]: bought }));
  }
  function pick(c: SearchCandidate) {
    if (cartFind(cart, c.externalId)) { setCart((l) => cartRemove(l, c.externalId)); return; }
    setCart((l) => cartAdd(l, c, choice[c.externalId] ?? false));
  }

  async function submit(only?: CartEntry[]) {
    const sent = only ?? cartPayable(cartRef.current);
    if (sent.length === 0 || busy) return;
    setBusy(true);
    setRequestFailed(false);
    try {
      const r = await addManualBatch(toBatchItems(sent, only !== undefined));
      const ap = applyBatch(cartRef.current, sent, r.results);
      cartRef.current = ap.cart;
      setCart(ap.cart);
      setDone((d) => ({ ...d, ...ap.outcomes }));
      for (const o of Object.values(ap.outcomes)) if (o.kind === 'added') addedRef.current.push({ title: o.title, bought: o.bought });
      setHadResult(true);
      setLive(addedLiveText(ap.created));
      if (ap.cart.length === 0) {
        setBanner(null);
        setOpenPref(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      } else {
        // для одиночного «Всё равно добавить» прежний баннер остаётся, пока в корзине есть неудавшиеся
        if (only === undefined) setBanner(partialBannerText(ap.created, ap.counted));
        setOpenPref(true);
        if (only === undefined) requestAnimationFrame(() => bannerRef.current?.focus());
      }
    } catch {
      // сеть/5xx: ничего не менялось, повтор безопасен (сервер идемпотентен)
      setRequestFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // ---------- закрытие ----------
  const finish = () => onClose(addedRef.current);
  function requestClose() {
    if (busy) return;
    if (confirming) { setConfirming(false); requestAnimationFrame(() => inputRef.current?.focus()); return; }
    if (cart.length > 0) { setConfirming(true); return; }
    finish();
  }

  return (
    <Sheet open onClose={requestClose} title="Добавить из магазина PS" className="ps-add-sheet" initialFocus="[data-testid='add-input']" busy={busy}>
      <div className="ps-add" data-testid="add-sheet">
        <p className="ps-sheet__sub ps-add__sub">
          Выбери «Купил» или «Не купил», нажми «+» у нужных игр и добавь всё сразу. «Не купил» попадёт в секцию «Не куплено», «Купил» будет ждать первого запуска.
        </p>
        <form
          className="ps-add__form" role="search"
          onSubmit={(e) => { e.preventDefault(); if (!quota) void search(q); }}
        >
          <label className="ps-add__field">
            <Icon name="search" size={16} />
            <input
              ref={inputRef} type="search" className="ps-input ps-add__input" data-testid="add-input" value={q} placeholder="Название игры"
              aria-label="Поиск игры в каталоге" autoComplete="off" enterKeyHint="search" maxLength={MAX_QUERY} disabled={quota}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && !quota && (
              <button type="button" className="ps-add__clear" aria-label="Очистить поле" onClick={clear}><Icon name="x" size={16} /></button>
            )}
          </label>
          <button
            type="submit" className="ps-btn ps-btn--primary ps-add__go" data-testid="add-submit" disabled={!ok || quota} aria-busy={phase === 'loading' || undefined}
            aria-describedby={!ok ? hintId : undefined}
          >
            {phase === 'loading' ? <><Icon name="loader" size={14} className="ps-nb-spin" />Ищу…</> : 'Найти'}
          </button>
          <span id={hintId} className="ps-sr">Введи минимум 2 символа</span>
        </form>

        <div className="ps-add__body">
          <p className="ps-sr" aria-live="polite">{live}</p>
          {failure?.kind === 'quota' && (
            <div ref={quotaRef} tabIndex={-1} className="ps-rec-banner ps-add__banner" role="status" data-testid="add-quota">
              <Icon name="circle-alert" size={16} />
              <span>
                Лимит запросов к каталогу исчерпан. Новый поиск станет доступен {failure.resetAt ? (formatDayMonth(failure.resetAt) ?? 'позже') : 'позже'}.
              </span>
            </div>
          )}
          {(failure?.kind === 'error' || failure?.kind === 'offline') && (
            <div className="ps-rec-banner ps-add__banner" role="alert" data-testid="add-error">
              <Icon name="circle-alert" size={16} />
              <span>{failure.kind === 'offline' ? 'Нет соединения. Поиск недоступен офлайн.' : 'Не удалось выполнить поиск.'}</span>
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" data-testid="add-retry" onClick={() => void search(asked || q)}>
                <Icon name="refresh" size={14} />Повторить
              </button>
            </div>
          )}

          {phase === 'initial' && (
            <div className="ps-add__state" data-testid="add-empty">
              <Icon name="search" size={32} />
              <h3 className="ps-h3">Найди игру из магазина PS</h3>
              <p>Введи название и нажми «Найти». Показываю игры для PS5 и PS4.</p>
            </div>
          )}
          {phase === 'loading' && (
            <ul className="ps-add-list" aria-busy="true" aria-label="Загрузка результатов">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="ps-add-sk" aria-hidden="true">
                  <span className="ps-skeleton ps-add-sk__cover" />
                  <span className="ps-add-sk__lines"><span className="ps-skeleton ps-add-sk__l1" /><span className="ps-skeleton ps-add-sk__l2" /></span>
                </li>
              ))}
            </ul>
          )}
          {phase === 'noresults' && (
            <div className="ps-add__state" data-testid="add-noresults">
              <Icon name="search-x" size={32} />
              <h3 className="ps-h3">Ничего не найдено</h3>
              <p>По запросу «<span className="ps-add__q">{asked}</span>» нет игр для PS5 и PS4. Проверь написание или введи название по-английски.</p>
              <button type="button" className="ps-btn ps-btn--ghost" onClick={reset}>Очистить поиск</button>
            </div>
          )}
          {phase === 'unavailable' && (
            <div className="ps-add__state" data-testid="add-unavailable">
              <Icon name="circle-alert" size={32} />
              <h3 className="ps-h3">Каталог игр недоступен</h3>
              <p>Поиск временно не работает. Остальной Бэклог доступен.</p>
              <button type="button" className="ps-btn ps-btn--ghost" onClick={finish}>Закрыть</button>
            </div>
          )}
          {phase === 'results' && (
            <>
              <ul className="ps-add-list" aria-label="Результаты поиска" aria-busy={busy || undefined}>
                {results.map((c) => {
                  const entry = cartFind(cart, c.externalId);
                  return (
                    <AddRow
                      key={c.externalId} c={c} done={done[c.externalId]} entry={entry} bought={entry ? entry.bought : choice[c.externalId] ?? false}
                      limitReached={full && !entry} busy={busy} onBought={(b) => setBought(c, b)} onPick={() => pick(c)}
                    />
                  );
                })}
              </ul>
              {results.length >= MAX_RESULTS && <p className="ps-add__more">Показаны первые {MAX_RESULTS}. Уточни название.</p>}
            </>
          )}
        </div>

        {confirming ? (
          <div className="ps-cart ps-cart--confirm" role="alertdialog" aria-labelledby={confirmId} data-testid="add-close-confirm">
            <p id={confirmId} className="ps-cart__confirm-t">Выбрано {cart.length} {cart.length === 1 ? 'игра' : 'игр'}, они ещё не добавлены.</p>
            <div className="ps-cart__confirm-b">
              <button ref={backRef} type="button" className="ps-btn ps-btn--primary" data-testid="add-close-back" onClick={() => { setConfirming(false); requestAnimationFrame(() => inputRef.current?.focus()); }}>Вернуться</button>
              <button type="button" className="ps-btn ps-btn--ghost" data-testid="add-close-discard" onClick={finish}>Закрыть без добавления</button>
            </div>
          </div>
        ) : (
          <AddCart
            cart={cart} busy={busy} online={online} expanded={cartExpanded} onToggle={() => setOpenPref(!cartExpanded)}
            onSetBought={(id, b) => setCart((l) => cartSetBought(l, id, b))} onRemove={(id) => setCart((l) => cartRemove(l, id))}
            onClear={() => { setCart([]); setBanner(null); setRequestFailed(false); setOpenPref(null); requestAnimationFrame(() => inputRef.current?.focus()); }}
            onSubmit={() => void submit()} onConfirmDuplicate={(id) => { const e = cartFind(cartRef.current, id); if (e) void submit([e]); }}
            banner={banner} bannerRef={bannerRef} requestFailed={requestFailed} onOpenGame={finish}
          />
        )}

        <div className="ps-add__foot">
          <p className="ps-rec-note">
            <span>Данные об играх:</span>
            <a className="ps-rec-note__link" href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="RAWG (новая вкладка)">RAWG<Icon name="external-link" size={12} /></a>
          </p>
          <button type="button" className="ps-btn ps-btn--ghost" data-testid="add-close" disabled={busy} onClick={requestClose}>Закрыть</button>
        </div>
      </div>
    </Sheet>
  );
}

function AddRow({
  c, done, entry, bought, limitReached, busy, onBought, onPick,
}: {
  c: SearchCandidate; done: RowOutcome | undefined; entry: CartEntry | undefined; bought: boolean; limitReached: boolean; busy: boolean;
  onBought: (bought: boolean) => void; onPick: () => void;
}) {
  const plats = platformsText(c.platforms);
  const picked = !!entry;
  const needsDecision = entry?.state === 'duplicate';
  return (
    <li className="ps-add-row" data-testid="add-row" data-state={done ? done.kind : needsDecision ? 'dup' : picked ? 'picked' : 'idle'} data-picked={picked || undefined} aria-busy={busy && picked ? true : undefined}>
      <Cover url={c.coverUrl} title={c.title} className="ps-add-row__cover" />
      <div className="ps-add-row__text">
        <span className="ps-add-row__title" title={c.title}>{c.title}</span>
        <span className="ps-add-row__meta">{searchReleaseText(c.releaseDate)}</span>
        {plats && <span className="ps-add-row__meta">{plats}</span>}
      </div>
      <div className="ps-add-row__act">
        {done ? (
          <span className="ps-add-row__done" data-testid="add-row-done" data-kind={done.kind}>
            <Icon name="check" size={14} />
            {done.kind === 'added' ? `Добавлено · ${done.bought ? 'Купил' : 'Не куплено'}` : 'Уже в бэклоге'}
          </span>
        ) : needsDecision ? (
          <span className="ps-add-row__done ps-add-row__need" data-testid="add-row-need"><Icon name="circle-alert" size={14} />Нужно решение</span>
        ) : (
          <>
            <BuySegment title={c.title} bought={bought} disabled={busy} onChange={onBought} />
            <button
              type="button" className="ps-btn ps-btn--ghost ps-add-row__pick" data-testid="add-pick" aria-pressed={picked} disabled={busy || limitReached}
              aria-label={limitReached ? `Лимит: ${BATCH_MAX} игр за раз` : picked ? `Убрать из выбранных: ${c.title}` : `Выбрать: ${c.title}`} onClick={onPick}
            >
              <Icon name={picked ? 'check' : 'plus'} size={14} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
