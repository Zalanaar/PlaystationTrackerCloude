'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { fetchLibrary, fetchRecentCollections, type DiscoverItem } from './api';
import {
  buildPutBody, filterLibrary, foundText, LIST_PAGE, OWN_MODES, RECENT_LIMIT, sortLibrary, withoutRecent,
  type LibraryGame, type OwnMode, type PutBody,
} from './owned-model';

/** Миниатюра 32x43; нет обложки или она не грузится: буква на --surface-2. */
export function OwnedThumb({ url, name }: { url: string | null; name: string }) {
  const [bad, setBad] = useState(false);
  /* eslint-disable @next/next/no-img-element -- внешние обложки, оптимизация next/image не нужна */
  return url && !bad
    ? <img className="ps-own-thumb" src={url} alt="" width={32} height={43} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className="ps-own-thumb ps-own-thumb--empty" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
  /* eslint-enable @next/next/no-img-element */
}

type Lib = { state: 'loading' } | { state: 'error' } | { state: 'ready'; games: LibraryGame[] };

function Row({ game, selected, tabbable, onPick }: { game: LibraryGame; selected: boolean; tabbable: boolean; onPick: (g: LibraryGame) => void }) {
  return (
    <button
      type="button" role="radio" aria-checked={selected} tabIndex={tabbable ? 0 : -1} className="ps-own-row" data-selected={selected || undefined}
      data-testid="owned-row" onClick={() => onPick(game)}
    >
      <OwnedThumb url={game.imageUrl} name={game.name} />
      <span className="ps-own-row__name" title={game.name}>{game.name}</span>
      {selected && <Icon name="check" size={16} />}
    </button>
  );
}

function PickPanel({ lib, retry, selectedId, onSelect, onGoNone, setLive }: {
  lib: Lib; retry: () => void; selectedId: number | null; onSelect: (g: LibraryGame) => void; onGoNone: () => void;
  setLive: (s: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(LIST_PAGE);
  const [recents, setRecents] = useState<LibraryGame[]>([]);
  const groupRef = useRef<HTMLDivElement>(null);
  const hasQuery = query.trim() !== '';

  useEffect(() => {
    const ac = new AbortController();
    fetchRecentCollections(RECENT_LIMIT, ac.signal)
      .then((r) => setRecents(r.collections.map((c) => ({ id: c.gameId, name: c.name, imageUrl: c.imageUrl }))))
      .catch(() => { /* без недавних список просто алфавитный */ });
    return () => ac.abort();
  }, []);

  const all = useMemo(() => (lib.state === 'ready' ? sortLibrary(lib.games) : []), [lib]);
  const results = useMemo(() => (hasQuery ? filterLibrary(all, query) : []), [all, hasQuery, query]);
  const rest = useMemo(() => withoutRecent(all, recents.map((r) => r.id)), [all, recents]);
  const list = hasQuery ? results : rest;
  const shown = list.slice(0, limit);
  const showRecents = !hasQuery && recents.length > 0 && lib.state === 'ready';
  const firstId = showRecents ? recents[0].id : shown[0]?.id ?? null;
  const tabId = selectedId !== null && (showRecents ? [...recents, ...shown] : shown).some((g) => g.id === selectedId) ? selectedId : firstId;

  useEffect(() => {
    if (!hasQuery || lib.state !== 'ready') return;
    const t = setTimeout(() => setLive(foundText(results.length)), 300);
    return () => clearTimeout(t);
  }, [hasQuery, results.length, lib.state, setLive]);

  const radios = () => Array.from(groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
  function onGroupKey(e: KeyboardEvent<HTMLDivElement>) {
    const rs = radios();
    const i = rs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = Math.min(i + 1, rs.length - 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = Math.max(i - 1, 0);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = rs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    rs[n].focus();
    rs[n].click();
  }
  function clear() { setQuery(''); setLimit(LIST_PAGE); }

  return (
    <div className="ps-own-pick">
      <p className="ps-own-help">Например, Uncharted 3 входит в сборник Nathan Drake Collection. Выбери игру из своей библиотеки.</p>
      <div className="ps-own-search">
        <span className="ps-own-search__ic" aria-hidden="true"><Icon name="search" size={16} /></span>
        <input
          type="search" className="ps-input ps-own-search__in" placeholder="Найти игру в библиотеке" aria-label="Поиск по библиотеке"
          autoComplete="off" value={query} disabled={lib.state === 'loading'}
          onChange={(e) => { setQuery(e.target.value); setLimit(LIST_PAGE); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { const r = radios(); if (r.length) { e.preventDefault(); (r.find((x) => x.tabIndex === 0) ?? r[0]).focus(); } } }}
        />
        {query && (
          <button type="button" className="ps-own-search__clear" aria-label="Очистить поиск" onClick={clear}><Icon name="x" size={16} /></button>
        )}
      </div>

      {lib.state === 'error' && (
        <div className="ps-rec-banner" role="alert">
          <Icon name="circle-alert" size={16} />
          <span>Не удалось загрузить библиотеку.</span>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={retry}><Icon name="refresh" size={14} />Повторить</button>
        </div>
      )}

      {lib.state === 'loading' && (
        <div className="ps-own-list" aria-busy="true" aria-label="Загрузка библиотеки">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="ps-skeleton ps-own-sk" aria-hidden="true" />)}
        </div>
      )}

      {lib.state === 'ready' && all.length === 0 && (
        <div className="ps-own-empty">
          <Icon name="library" size={32} />
          <h3 className="ps-h3">В библиотеке пока пусто</h3>
          <p>Игры появятся после первого синка с PSN. Пока можно выбрать «Нет в библиотеке».</p>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={onGoNone}>Нет в библиотеке</button>
        </div>
      )}

      {lib.state === 'ready' && all.length > 0 && hasQuery && results.length === 0 && (
        <div className="ps-own-empty">
          <Icon name="search-x" size={32} />
          <p className="ps-own-empty__q">Ничего не найдено по «{query.trim()}»</p>
          <div className="ps-own-empty__btns">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={clear}>Очистить поиск</button>
            <button type="button" className="ps-btn ps-btn--ghost" onClick={onGoNone}>Нет в библиотеке</button>
          </div>
        </div>
      )}

      {lib.state === 'ready' && list.length + (showRecents ? recents.length : 0) > 0 && (
        <div ref={groupRef} className="ps-own-list" role="radiogroup" aria-label="Игра из библиотеки" onKeyDown={onGroupKey}>
          {showRecents && (
            <>
              <h3 className="ps-own-h">Недавно выбранные</h3>
              {recents.map((g) => <Row key={`r${g.id}`} game={g} selected={selectedId === g.id} tabbable={tabId === g.id} onPick={onSelect} />)}
            </>
          )}
          {list.length > 0 && <h3 className="ps-own-h">{hasQuery ? `Результаты · ${results.length}` : 'Библиотека'}</h3>}
          {shown.map((g) => <Row key={g.id} game={g} selected={selectedId === g.id} tabbable={tabId === g.id} onPick={onSelect} />)}
          {list.length > shown.length && (
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-own-more" onClick={() => setLimit((n) => n + LIST_PAGE)}>Показать ещё</button>
          )}
        </div>
      )}
    </div>
  );
}

function Body({ item, onClose, onSubmit }: {
  item: DiscoverItem; onClose: () => void; onSubmit: (item: DiscoverItem, body: PutBody) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<OwnMode>('covered');
  const [lib, setLib] = useState<Lib>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<LibraryGame | null>(null);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [live, setLive] = useState('');
  const hintId = useId();
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    fetchLibrary(ac.signal)
      .then((games) => setLib({ state: 'ready', games }))
      .catch(() => { if (!ac.signal.aborted) setLib({ state: 'error' }); });
    return () => ac.abort();
  }, [attempt]);

  const canSave = mode === 'none' || selected !== null;
  async function save() {
    const body = buildPutBody(item, mode, selected?.id ?? null, completed);
    if (!body || saving) return;
    setSaving(true);
    setSaveErr(false);
    const ok = await onSubmit(item, body);
    if (!ok) { setSaving(false); setSaveErr(true); }
  }
  function pickMode(i: number) {
    setMode(OWN_MODES[i].value);
    modeRefs.current[i]?.focus();
  }
  function onModeKey(e: KeyboardEvent, i: number) {
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % OWN_MODES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + OWN_MODES.length - 1) % OWN_MODES.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = OWN_MODES.length - 1;
    if (n < 0) return;
    e.preventDefault();
    pickMode(n);
  }

  return (
    <Sheet open onClose={saving ? () => {} : onClose} title="Уже есть у тебя" className="ps-own-sheet">
      <div className="ps-own" aria-busy={saving || undefined}>
        <p className="ps-sheet__sub ps-own-sub" title={item.title}>«{item.title}»</p>
        <div className="ps-seg ps-own-modes" role="radiogroup" aria-label="Как отметить игру">
          {OWN_MODES.map((m, i) => (
            <button
              key={m.value} ref={(el) => { modeRefs.current[i] = el; }} type="button" role="radio" aria-checked={mode === m.value}
              tabIndex={mode === m.value ? 0 : -1} disabled={saving} onClick={() => setMode(m.value)} onKeyDown={(e) => onModeKey(e, i)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="ps-own-scroll">
          {mode === 'covered' ? (
            <PickPanel
              lib={lib} retry={() => { setLib({ state: 'loading' }); setAttempt((n) => n + 1); }}
              selectedId={selected?.id ?? null}
              onSelect={(g) => { setSelected(g); setLive(`Выбрано: ${g.name}`); }}
              onGoNone={() => setMode('none')} setLive={setLive}
            />
          ) : (
            <div className="ps-own-none">
              <p className="ps-own-text">Игра есть у тебя вне библиотеки (диск, другой аккаунт, ПК) или ты её уже проходил. Она больше не появится в подборках.</p>
              <label className="ps-own-check">
                <input type="checkbox" checked={completed} disabled={saving} onChange={(e) => setCompleted(e.target.checked)} />
                <span className="ps-own-check__box" aria-hidden="true"><Icon name="check" size={14} /></span>
                <span>Прошёл эту игру</span>
              </label>
              <p className="ps-own-help ps-own-help--3">Отметка «прошёл» не меняет твои вкусы и подборки, игра просто не попадает в советы.</p>
            </div>
          )}
        </div>

        {saveErr && (
          <div className="ps-rec-banner" role="alert"><Icon name="circle-alert" size={16} /><span>Не удалось сохранить. Повтори.</span></div>
        )}
        <div className="ps-own-foot">
          <button
            type="button" className="ps-btn ps-btn--primary ps-own-foot__save" disabled={!canSave || saving}
            aria-describedby={canSave ? undefined : hintId} onClick={() => void save()}
          >
            {saving && <span className="ps-rec__spin" aria-hidden="true" />}
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button type="button" className="ps-btn ps-btn--ghost" disabled={saving} onClick={onClose}>Отмена</button>
        </div>
        <span id={hintId} className="ps-own-sr">Выбери игру из библиотеки</span>
        <div className="ps-own-sr" aria-live="polite">{live}</div>
      </div>
    </Sheet>
  );
}

/** Лист «Уже есть у тебя» (спека 16.2). Сохранение делает родитель (`onSubmit` -> true, если отметка записана). */
export function OwnedSheet({ item, onClose, onSubmit }: {
  item: DiscoverItem | null; onClose: () => void; onSubmit: (item: DiscoverItem, body: PutBody) => Promise<boolean>;
}) {
  return item ? <Body key={item.externalId} item={item} onClose={onClose} onSubmit={onSubmit} /> : null;
}
