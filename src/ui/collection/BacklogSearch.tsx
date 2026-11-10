'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { GameItem } from '@/server/collection/types';
import { Icon, StatusGlyph } from '../icons';
import { CatalogCredit, catalogsOf } from '../catalog/CatalogCredit';
import { mskDay } from '../inbox/model';
import { Cover } from './Cover';
import { NotPurchasedBadge } from './NotPurchasedBadge';
import { addManual } from './manualApi';
import {
  manualMeta, parseDuplicate, platformsText, searchReleaseText, type ManualGame, type SearchCandidate,
} from './manual';
import {
  LOCAL_MAX, STORE_MAX_POPUP, STORE_MAX_SHEET, SUGGEST_MIN, enterWithoutActive, filterByTitle, highlightParts, hintText, liveText, mergeLocal, moveActive, suggestQuery,
  type StoreState,
} from './suggest';
import { useLocalGames, useStoreSuggest } from './useSuggest';

/** Что выбрано в блоке «Из списка»: родитель прокручивает к игре и ставит фокус (design-system §19b.5). */
export type SearchPick = { kind: 'game'; game: GameItem } | { kind: 'manual'; item: ManualGame };

type Opt =
  | { id: string; kind: 'lib'; game: GameItem }
  | { id: string; kind: 'man'; item: ManualGame }
  | { id: string; kind: 'store'; cand: SearchCandidate }
  | { id: string; kind: 'more' }
  | { id: string; kind: 'retry' };
type AddState = 'adding' | 'added' | 'already' | 'dup' | 'error';

function Hl({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((p, i) => (p.hit ? <mark key={i} className="ps-hl">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

/**
 * Умный поиск Бэклога (design-system §19b.5): одно combobox-поле, «Из списка» (локально с 1 символа) и «Из магазина PS» (RAWG, с 3 символов).
 * variant=inline: popup под полем (>= 768); variant=sheet: те же подсказки в потоке листа «Поиск» (< 768).
 */
export function BacklogSearch({
  variant, manual, appliedQ, onApply, onPick, onAdded, onOpenStore, onDone,
}: {
  variant: 'inline' | 'sheet';
  manual: readonly ManualGame[];
  appliedQ: string;
  onApply: (q: string) => void;
  onPick: (p: SearchPick) => void;
  /** игра добавлена из подсказки как «Не куплено» */
  onAdded: (title: string) => void;
  /** «Все результаты в магазине PS» и Enter при мягком пределе */
  onOpenStore: (q: string) => void;
  /** лист: действие выполнено, лист можно закрыть */
  onDone?: () => void;
}) {
  const sheet = variant === 'sheet';
  const [text, setText] = useState(appliedQ);
  const [prevApplied, setPrevApplied] = useState(appliedQ);
  if (prevApplied !== appliedQ) { setPrevApplied(appliedQ); setText(appliedQ); }
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [adds, setAdds] = useState<Record<string, AddState>>({});
  const [today] = useState(() => mskDay(Date.now()));
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const q = suggestQuery(text);
  const showPop = q.length > 0 && (sheet || open);

  const local = useLocalGames(text, showPop);
  const store = useStoreSuggest(text, showPop, sheet ? STORE_MAX_SHEET : STORE_MAX_POPUP);
  const merged = mergeLocal(local.items, filterByTitle(manual, q), LOCAL_MAX);
  const localN = merged.lib.length + merged.man.length;
  const storeItems = store.state.kind === 'results' ? store.state.items : [];

  const opts: Opt[] = [];
  merged.lib.forEach((game) => opts.push({ id: `${baseId}-o${opts.length}`, kind: 'lib', game }));
  merged.man.forEach((item) => opts.push({ id: `${baseId}-o${opts.length}`, kind: 'man', item }));
  storeItems.forEach((cand) => opts.push({ id: `${baseId}-o${opts.length}`, kind: 'store', cand }));
  if (storeItems.length > 0) opts.push({ id: `${baseId}-o${opts.length}`, kind: 'more' });
  if (store.state.kind === 'error') opts.push({ id: `${baseId}-o${opts.length}`, kind: 'retry' });
  const act = showPop && active >= 0 && active < opts.length ? active : -1;
  const activeId = act >= 0 ? opts[act].id : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const settled = local.settled && store.state.kind !== 'loading';
  const live = showPop && settled ? liveText(localN, store.state) : '';

  async function addOne(cand: SearchCandidate) {
    const cur = adds[cand.externalId];
    if (cur === 'adding' || cur === 'added') return;
    if (cand.inBacklog) { setAdds((a) => ({ ...a, [cand.externalId]: 'already' })); return; }
    setAdds((a) => ({ ...a, [cand.externalId]: 'adding' }));
    try {
      const r = await addManual({ externalSource: 'rawg', externalId: cand.externalId, title: cand.title, coverUrl: cand.coverUrl, releaseDate: cand.releaseDate });
      setAdds((a) => ({ ...a, [cand.externalId]: r.created ? 'added' : 'already' }));
      if (r.created) onAdded(cand.title);
    } catch (e) {
      if (parseDuplicate(e)) { setAdds((a) => ({ ...a, [cand.externalId]: 'dup' })); return; }
      const st = (e as { status?: number; code?: string } | null) ?? {};
      if (st.status === 409 && st.code !== 'manual_limit') { setAdds((a) => ({ ...a, [cand.externalId]: 'already' })); return; }
      setAdds((a) => ({ ...a, [cand.externalId]: 'error' }));
    }
  }

  function run(o: Opt) {
    if (o.kind === 'lib') { setOpen(false); onPick({ kind: 'game', game: o.game }); onDone?.(); }
    else if (o.kind === 'man') { setOpen(false); onPick({ kind: 'manual', item: o.item }); onDone?.(); }
    else if (o.kind === 'more') { setOpen(false); onOpenStore(q); onDone?.(); }
    else if (o.kind === 'retry') store.retry();
    else {
      const st = adds[o.cand.externalId];
      if (st === 'dup') { setOpen(false); onOpenStore(o.cand.title); onDone?.(); }
      else void addOne(o.cand);
    }
  }

  function apply() {
    setOpen(false);
    setActive(-1);
    onApply(q);
    onDone?.();
  }
  function clear() {
    setText('');
    setActive(-1);
    setOpen(false);
    if (appliedQ) onApply('');
    inputRef.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showPop) { if (q.length > 0) setOpen(true); return; }
      setActive(moveActive(act, opts.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showPop) setActive(moveActive(act, opts.length, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (act >= 0) { run(opts[act]); return; }
      if (q.length >= SUGGEST_MIN && enterWithoutActive(store.state) === 'store') { setOpen(false); onOpenStore(q); onDone?.(); return; }
      apply();
    } else if (e.key === 'Escape') {
      // type=search сам стирает значение по Esc: гасим, чтобы первый Esc только закрывал список
      if (showPop && !sheet) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); }
      else if (text) { e.preventDefault(); e.stopPropagation(); clear(); }
      // пустое поле: в листе Esc закрывает лист (событие идёт дальше), на странице ничего
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const stateLines: ReactNode[] = [];
  const noneAll = q.length >= SUGGEST_MIN && localN === 0 && local.settled && (store.state.kind === 'empty' || store.state.kind === 'hidden');
  if (q.length > 0 && q.length < SUGGEST_MIN && local.settled && localN === 0) {
    stateLines.push(<p key="ln" className="ps-bs__line" data-testid="bs-state" data-kind="localnone"><Icon name="search" size={14} />В списке нет совпадений</p>);
  }
  const sk = store.state;
  if (noneAll) {
    stateLines.push(
      <div key="none" className="ps-bs__none" data-testid="bs-state" data-kind="none">
        <p><Icon name="search-x" size={16} />Ничего не найдено по «<span className="ps-add__q">{q}</span>»</p>
        <p className="ps-bs__sub">Нажми Enter, чтобы применить фильтр по списку</p>
      </div>,
    );
  } else {
    stateLines.push(...storeLines(sk, q));
  }

  return (
    <div
      ref={wrapRef} className="ps-bs" data-variant={variant}
      onBlur={(e) => { if (!sheet && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <div className="ps-bs__field">
        <Icon name="search" size={16} />
        <input
          ref={inputRef} type="search" className="ps-input ps-bs__input" data-testid="bs-input" value={text} placeholder="Поиск по списку и магазину PS"
          aria-label="Поиск по списку и магазину PS" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" maxLength={80}
          role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={showPop} aria-controls={showPop && opts.length > 0 ? listId : undefined}
          aria-activedescendant={activeId}
          onChange={(e) => { setText(e.target.value); setActive(-1); setOpen(true); }} onKeyDown={onKey}
        />
        {text && <button type="button" className="ps-bs__clear" aria-label="Очистить поиск" data-testid="bs-clear" onClick={clear}><Icon name="x" size={16} /></button>}
      </div>
      <div className="ps-sr" aria-live="polite" aria-atomic="true" data-testid="bs-live">{live}</div>

      {showPop && (
        <div className="ps-bs__pop" data-testid="bs-pop" onMouseDown={(e) => e.preventDefault()}>
          {opts.length > 0 && (
            <div id={listId} role="listbox" aria-label="Результаты поиска" className="ps-bs__list">
              {localN > 0 && (
                <div role="group" aria-labelledby={`${baseId}-gl`} data-testid="bs-local">
                  <div id={`${baseId}-gl`} className="ps-bs__cap">Из списка · {localN}</div>
                  {opts.filter((o) => o.kind === 'lib' || o.kind === 'man').map((o) => {
                    const i = opts.indexOf(o);
                    return o.kind === 'lib'
                      ? <LibOption key={o.id} o={o} on={i === act} q={q} onRun={() => run(o)} />
                      : o.kind === 'man' ? <ManOption key={o.id} o={o} on={i === act} q={q} today={today} onRun={() => run(o)} /> : null;
                  })}
                </div>
              )}
              {storeItems.length > 0 && (
                <div role="group" aria-labelledby={`${baseId}-gs`} data-testid="bs-store">
                  <div id={`${baseId}-gs`} className="ps-bs__cap">Из магазина PS · {storeItems.length}</div>
                  {opts.filter((o) => o.kind === 'store').map((o) => {
                    const i = opts.indexOf(o);
                    return o.kind === 'store'
                      ? <StoreOption key={o.id} o={o} on={i === act} q={q} state={adds[o.cand.externalId]} onRun={() => run(o)} onActivate={() => setActive(i)} />
                      : null;
                  })}
                  {opts.filter((o) => o.kind === 'more').map((o) => (
                    <div
                      key={o.id} id={o.id} role="option" aria-selected={opts.indexOf(o) === act} className="ps-bs-opt ps-bs-opt--more" data-testid="bs-more"
                      onClick={() => run(o)}
                    ><Icon name="search" size={14} />Все результаты в магазине PS</div>
                  ))}
                </div>
              )}
              {opts.filter((o) => o.kind === 'retry').map((o) => (
                <div
                  key={o.id} id={o.id} role="option" aria-selected={opts.indexOf(o) === act} className="ps-bs-opt ps-bs-opt--retry" data-testid="bs-retry"
                  aria-label="Не удалось получить подсказки. Повторить" onClick={() => run(o)}
                >
                  <Icon name="circle-alert" size={14} /><span>Не удалось получить подсказки.</span>
                  <span className="ps-btn ps-btn--ghost ps-btn--sm ps-bs-opt__btn" aria-hidden="true"><Icon name="refresh" size={14} />Повторить</span>
                </div>
              ))}
            </div>
          )}
          {sk.kind === 'error' && <p className="ps-sr" role="alert" data-testid="bs-state" data-kind="error">Не удалось получить подсказки.</p>}
          {stateLines}
          {sk.kind !== 'hidden' && q.length >= SUGGEST_MIN && (!sheet || catalogsOf(storeItems).some((k) => k !== 'rawg')) && (
            <CatalogCredit variant="inline" className="ps-bs__attr" list={storeItems} />
          )}
        </div>
      )}
    </div>
  );
}

function storeLines(s: StoreState, q: string): ReactNode[] {
  switch (s.kind) {
    case 'hint':
      return [<p key="h" className="ps-bs__line" data-testid="bs-state" data-kind="hint"><Icon name="search" size={14} />{hintText(s.len)}</p>];
    case 'loading':
      return [
        <div key="l" className="ps-bs__sk" aria-busy="true" data-testid="bs-state" data-kind="loading" role="status">
          <span className="ps-sr">Ищу в магазине PS…</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="ps-bs-sk" aria-hidden="true">
              <span className="ps-skeleton ps-bs-sk__cover" />
              <span className="ps-bs-sk__lines"><span className="ps-skeleton ps-bs-sk__l1" /><span className="ps-skeleton ps-bs-sk__l2" /></span>
            </span>
          ))}
        </div>,
      ];
    case 'empty':
      return [<p key="e" className="ps-bs__line" data-testid="bs-state" data-kind="empty"><Icon name="search-x" size={14} /><span>В магазине нет игр для PS5 и PS4 по «<span className="ps-add__q">{q}</span>»</span></p>];
    case 'limited':
      return [
        <p key="m" className="ps-bs__line" role="status" data-testid="bs-state" data-kind="limited">
          <Icon name="circle-alert" size={14} />Подсказки из магазина отключены, чтобы не тратить лимит. Нажми Enter, чтобы найти в магазине PS.
        </p>,
      ];
    case 'quota':
      return [
        <div key="q" className="ps-rec-banner ps-bs__banner" role="status" data-testid="bs-state" data-kind="quota">
          <Icon name="circle-alert" size={16} /><span>Лимит запросов к каталогу исчерпан. Подсказки из магазина вернутся позже.</span>
        </div>,
      ];
    case 'offline':
      return [
        <p key="o" className="ps-bs__line" role="status" data-testid="bs-state" data-kind="offline">
          <Icon name="circle-alert" size={14} />Нет соединения. Подсказки из магазина недоступны, список ищется как обычно.
        </p>,
      ];
    default:
      return [];
  }
}

function LibOption({ o, on, q, onRun }: { o: Extract<Opt, { kind: 'lib' }>; on: boolean; q: string; onRun: () => void }) {
  return (
    <div id={o.id} role="option" aria-selected={on} className="ps-bs-opt ps-bs-opt--local" data-testid="bs-opt" data-kind="lib" aria-label={`${o.game.title}, в бэклоге, перейти к игре`} onClick={onRun}>
      <Cover url={o.game.coverUrl} title={o.game.title} className="ps-bs-opt__cover" />
      <span className="ps-bs-opt__text">
        <span className="ps-bs-opt__title" title={o.game.title}><Hl text={o.game.title} query={q} /></span>
        <span className="ps-bs-opt__meta"><StatusGlyph status="backlog" size={12} />Бэклог</span>
      </span>
    </div>
  );
}

function ManOption({ o, on, q, today, onRun }: { o: Extract<Opt, { kind: 'man' }>; on: boolean; q: string; today: string; onRun: () => void }) {
  const g = o.item;
  return (
    <div
      id={o.id} role="option" aria-selected={on} className="ps-bs-opt ps-bs-opt--local" data-testid="bs-opt" data-kind="manual"
      aria-label={`${g.title}, ${g.notPurchased ? 'не куплено' : 'в бэклоге'}, перейти к игре`} onClick={onRun}
    >
      <Cover url={g.coverUrl} title={g.title} className="ps-bs-opt__cover" />
      <span className="ps-bs-opt__text">
        <span className="ps-bs-opt__title" title={g.title}><Hl text={g.title} query={q} /></span>
        <span className="ps-bs-opt__meta">{manualMeta(g, today)}</span>
      </span>
      {g.notPurchased && <NotPurchasedBadge />}
    </div>
  );
}

function StoreOption({ o, on, q, state, onRun, onActivate }: { o: Extract<Opt, { kind: 'store' }>; on: boolean; q: string; state: AddState | undefined; onRun: () => void; onActivate: () => void }) {
  const c = o.cand;
  const st: AddState | undefined = state ?? (c.inBacklog ? 'already' : undefined);
  const plats = platformsText(c.platforms);
  const meta = [searchReleaseText(c.releaseDate), plats].filter(Boolean).join(' · ');
  const label =
    st === 'added' ? `${c.title}, добавлено, не куплено`
      : st === 'already' ? `${c.title}, уже в бэклоге`
        : st === 'dup' ? `${c.title}, уже есть, нажми Enter, чтобы решить`
          : st === 'error' ? `${c.title}, не удалось добавить, нажми Enter, чтобы повторить`
            : `${c.title}, из магазина PS, нажми Enter, чтобы добавить как «не куплено»`;
  return (
    <div
      id={o.id} role="option" aria-selected={on} aria-label={label} aria-busy={st === 'adding' || undefined} aria-disabled={st === 'added' || st === 'already' || undefined}
      className="ps-bs-opt ps-bs-opt--store" data-testid="bs-opt" data-kind="store" data-state={st ?? 'idle'}
      onClick={() => { if (st === 'dup' || st === 'error') onRun(); else onActivate(); }}
    >
      <Cover url={c.coverUrl} title={c.title} className="ps-bs-opt__cover" />
      <span className="ps-bs-opt__text">
        <span className="ps-bs-opt__title" title={c.title}><Hl text={c.title} query={q} /></span>
        <span className="ps-bs-opt__meta">{meta}</span>
      </span>
      <span className="ps-bs-opt__act">
        {st === 'added' ? <span className="ps-bs-opt__done"><Icon name="check" size={14} />Добавлено · Не куплено</span>
          : st === 'already' ? <span className="ps-bs-opt__done ps-bs-opt__done--dim"><Icon name="check" size={14} />Уже в бэклоге</span>
            : st === 'dup' ? <span className="ps-bs-opt__done"><Icon name="circle-alert" size={14} />Уже есть. <span className="ps-btn ps-btn--ghost ps-btn--sm ps-bs-opt__btn" aria-hidden="true">Решить</span></span>
              : st === 'error' ? <span className="ps-bs-opt__done" role="alert"><Icon name="circle-alert" size={14} />Не удалось. <span className="ps-btn ps-btn--ghost ps-btn--sm ps-bs-opt__btn" aria-hidden="true">Повторить</span></span>
                : (
                  <button type="button" className="ps-btn ps-btn--ghost ps-bs-opt__plus" tabIndex={-1} aria-hidden="true" data-testid="bs-opt-add" disabled={st === 'adding'} onClick={(ev) => { ev.stopPropagation(); onRun(); }}>
                    {st === 'adding' ? <Icon name="loader" size={14} className="ps-nb-spin" /> : <Icon name="plus" size={14} />}
                  </button>
                )}
      </span>
    </div>
  );
}
