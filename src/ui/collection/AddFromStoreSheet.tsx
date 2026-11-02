'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import '../recommend.css';
import { Icon } from '../icons';
import { formatDayMonth } from '../format';
import { Sheet } from '../primitives/Sheet';
import { addManual, searchManual } from './manualApi';
import { Cover } from './Cover';
import {
  MAX_QUERY, MAX_RESULTS, canSearch, classifySearchError, manualErrorText, normalizeQuery, parseDuplicate, platformsText, searchReleaseText,
  type DuplicateInfo, type SearchCandidate, type SearchFailure,
} from './manual';

type RowState = 'idle' | 'adding' | 'added' | 'already' | 'error' | 'dup';
type RowInfo = { state: RowState; dup?: DuplicateInfo; error?: string };
type Phase = 'initial' | 'loading' | 'results' | 'noresults' | 'unavailable';

/** Панель «Добавить из магазина PS» (design-system §19.4). Запрос уходит только по Enter или «Найти». Грузится лениво. */
export function AddFromStoreSheet({ onClose }: { onClose: (addedTitles: string[]) => void }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [phase, setPhase] = useState<Phase>('initial');
  const [results, setResults] = useState<SearchCandidate[]>([]);
  const [failure, setFailure] = useState<SearchFailure | null>(null);
  const [rows, setRows] = useState<Record<string, RowInfo>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [live, setLive] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const hintId = useId();
  const quotaRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => ctl.current?.abort(), []);

  const quota = failure?.kind === 'quota';
  const ok = canSearch(q);
  // поле и «Найти» выключаются: фокус не должен упасть на body (Esc перестал бы работать), переносим на баннер
  useEffect(() => { if (quota) quotaRef.current?.focus(); }, [quota]);

  const search = useCallback(async (query: string) => {
    const text = normalizeQuery(query);
    if (!canSearch(text)) return;
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
      setRows(Object.fromEntries(list.map((x) => [x.externalId, { state: x.inBacklog ? 'already' : 'idle' } as RowInfo])));
      setPhase(list.length > 0 ? 'results' : 'noresults');
      setLive(list.length > 0 ? `Найдено ${list.length} ${list.length === 1 ? 'игра' : 'игр'}` : 'Ничего не найдено');
    } catch (e) {
      if (my !== seq.current || c.signal.aborted) return;
      const f = classifySearchError(e, typeof navigator === 'undefined' || navigator.onLine !== false);
      setFailure(f);
      // каталог не настроен: отдельный экран; остальные сбои не стирают прежние результаты
      setPhase((p) => (f.kind === 'unavailable' ? 'unavailable' : p === 'loading' ? (results.length > 0 ? 'results' : 'initial') : p));
    }
  }, [results.length]);

  function setRow(id: string, patch: RowInfo) {
    setRows((r) => ({ ...r, [id]: patch }));
  }

  async function add(c: SearchCandidate, confirmDuplicate: boolean) {
    setRow(c.externalId, { state: 'adding' });
    try {
      const r = await addManual({ externalSource: 'rawg', externalId: c.externalId, title: c.title, coverUrl: c.coverUrl, releaseDate: c.releaseDate, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) });
      if (r.created) {
        setAdded((a) => [...a, c.title]);
        setLive(`Добавлено в бэклог: ${c.title}`);
        setRow(c.externalId, { state: 'added' });
      } else {
        setRow(c.externalId, { state: 'already' });
      }
    } catch (e) {
      const dup = parseDuplicate(e);
      if (dup) return setRow(c.externalId, { state: 'dup', dup });
      if (typeof e === 'object' && e !== null && (e as { status?: number }).status === 409 && (e as { code?: string }).code !== 'manual_limit') return setRow(c.externalId, { state: 'already' });
      setRow(c.externalId, { state: 'error', error: manualErrorText(e, 'Не удалось добавить. Повтори.') });
    }
  }

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

  const busy = Object.values(rows).some((r) => r.state === 'adding');
  const close = () => onClose(added);

  return (
    <Sheet open onClose={close} title="Добавить из магазина PS" className="ps-add-sheet" initialFocus="[data-testid='add-input']" busy={busy}>
      <div className="ps-add" data-testid="add-sheet">
        <p className="ps-sheet__sub ps-add__sub">Ищу игры для PS5 и PS4. Добавленная игра попадёт в Бэклог с пометкой «Не куплено».</p>
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
              <button type="button" className="ps-btn ps-btn--ghost" onClick={close}>Закрыть</button>
            </div>
          )}
          {phase === 'results' && (
            <>
              <ul className="ps-add-list" aria-label="Результаты поиска">
                {results.map((c) => (
                  <AddRow key={c.externalId} c={c} info={rows[c.externalId] ?? { state: 'idle' }} onAdd={(confirm) => void add(c, confirm)} onCancel={() => setRow(c.externalId, { state: 'idle' })} onClose={close} />
                ))}
              </ul>
              {results.length >= MAX_RESULTS && <p className="ps-add__more">Показаны первые {MAX_RESULTS}. Уточни название.</p>}
            </>
          )}
        </div>

        <div className="ps-add__foot">
          <p className="ps-rec-note">
            <span>Данные об играх:</span>
            <a className="ps-rec-note__link" href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="RAWG (новая вкладка)">RAWG<Icon name="external-link" size={12} /></a>
          </p>
          <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={close}>Закрыть</button>
        </div>
      </div>
    </Sheet>
  );
}

function AddRow({
  c, info, onAdd, onCancel, onClose,
}: { c: SearchCandidate; info: RowInfo; onAdd: (confirmDuplicate: boolean) => void; onCancel: () => void; onClose: () => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  const warnRef = useRef<HTMLDivElement>(null);
  const prev = useRef<RowState>(info.state);
  const warnId = useId();
  const { state } = info;

  // фокус следует за состоянием: добавлено -> статус, дубль -> блок, отмена дубля -> кнопка
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (was === state) return;
    if (state === 'added') doneRef.current?.focus();
    else if (state === 'dup') warnRef.current?.focus();
    else if (state === 'idle' && was === 'dup') btnRef.current?.focus();
    else if (state === 'error') btnRef.current?.focus();
  }, [state]);

  const plats = platformsText(c.platforms);
  const done = state === 'added' || state === 'already';
  const dup = info.dup;

  function warnKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <li className="ps-add-row" data-testid="add-row" data-state={state} aria-busy={state === 'adding' || undefined}>
      <Cover url={c.coverUrl} title={c.title} className="ps-add-row__cover" />
      <div className="ps-add-row__text">
        <span className="ps-add-row__title" title={c.title}>{c.title}</span>
        <span className="ps-add-row__meta">{searchReleaseText(c.releaseDate)}</span>
        {plats && <span className="ps-add-row__meta">{plats}</span>}
      </div>
      <div className="ps-add-row__act">
        {done ? (
          <span ref={doneRef} className="ps-add-row__done" data-testid="add-row-done" data-kind={state} tabIndex={-1}>
            <Icon name="check" size={14} />{state === 'added' ? 'Добавлено в бэклог' : 'Уже в бэклоге'}
          </span>
        ) : (
          <button
            ref={btnRef} type="button" className="ps-btn ps-btn--ghost ps-add-row__btn" data-testid="add-row-btn" aria-label={`В бэклог: ${c.title}`}
            disabled={state === 'adding' || state === 'dup'} onClick={() => onAdd(false)}
          >
            {state === 'adding' ? <><Icon name="loader" size={14} className="ps-nb-spin" />Добавляю…</> : <><Icon name="plus" size={14} />В бэклог</>}
          </button>
        )}
      </div>
      {state === 'error' && (
        <p className="ps-add-row__err" role="alert"><Icon name="circle-alert" size={14} />{info.error ?? 'Не удалось добавить. Повтори.'}</p>
      )}
      {state === 'dup' && dup && (
        <div ref={warnRef} className="ps-add-warn" role="group" aria-labelledby={warnId} tabIndex={-1} data-testid="add-warn" onKeyDown={warnKey}>
          <h4 id={warnId} className="ps-add-warn__h"><Icon name="circle-alert" size={16} />Такая игра уже есть</h4>
          {dup.game && <p className="ps-add-warn__t">В твоей библиотеке PSN: «{dup.game.name}»</p>}
          {dup.planned && <p className="ps-add-warn__t">В Плане: «{dup.planned.title}»</p>}
          <div className="ps-add-warn__btns">
            {dup.game && <Link href={`/?game=${dup.game.gameId}`} className="ps-link" onClick={onClose}>Открыть в библиотеке</Link>}
            <button type="button" className="ps-btn ps-btn--primary" data-testid="add-warn-confirm" aria-label={`Всё равно добавить: ${c.title}`} onClick={() => onAdd(true)}>Всё равно добавить</button>
            <button type="button" className="ps-btn ps-btn--ghost" data-testid="add-warn-cancel" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      )}
    </li>
  );
}
