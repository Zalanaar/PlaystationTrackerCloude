'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import '../recommend.css';
import { Icon } from '../icons';
import { formatDayMonth } from '../format';
import { Sheet } from '../primitives/Sheet';
import { Cover } from '../collection/Cover';
import { MAX_QUERY, MAX_RESULTS, canSearch, classifySearchError, normalizeQuery, parseDuplicate, searchReleaseText, type DuplicateInfo, type SearchFailure } from '../collection/manual';
import { catalogGuard, useOnline } from '../collection/useSuggest';
import { PLATFORM_NONE } from '@/shared/platforms';
import { addOtherPlatform, searchAllPlatforms, type OtherCandidate, type OtherPlatformGame } from './api';
import { addErrorText, foundGamesText } from './model';
import { PLATFORM_CHIPS, defaultChip } from './block';

type Phase = 'initial' | 'loading' | 'results' | 'noresults' | 'unavailable';
type Row =
  | { kind: 'adding' }
  | { kind: 'added'; label: string | null; focus: boolean }
  | { kind: 'already'; focus: boolean }
  | { kind: 'duplicate'; info: DuplicateInfo }
  | { kind: 'error'; text: string };

const initialFailure = (): SearchFailure | null => {
  const g = catalogGuard.status();
  return g.quota ? { kind: 'quota', resetAt: g.quotaResetAt } : null;
};

/**
 * Панель «Играл на другой платформе» (design-system §19c.4): поиск RAWG по всем платформам по Enter или «Найти»,
 * у каждой игры выбор платформы и «Добавить». Остаётся открытой после добавления; при закрытии отдаёт добавленные записи.
 */
export function AddOtherPlatformSheet({ onClose }: { onClose: (added: OtherPlatformGame[]) => void }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [phase, setPhase] = useState<Phase>('initial');
  const [results, setResults] = useState<OtherCandidate[]>([]);
  const [failure, setFailure] = useState<SearchFailure | null>(initialFailure);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [plat, setPlat] = useState<Record<string, string>>({});
  const [live, setLive] = useState('');
  const addedRef = useRef<OtherPlatformGame[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const quotaRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const hintId = useId();
  const online = useOnline();
  useEffect(() => () => ctl.current?.abort(), []);

  const quota = failure?.kind === 'quota';
  const ok = canSearch(q);
  const busy = Object.values(rows).some((r) => r.kind === 'adding');
  useEffect(() => { if (quota) quotaRef.current?.focus(); }, [quota]);
  // баннер/кнопка «Повторить» исчезли вместе с фокусом: возвращаем его в поле, иначе Esc перестаёт работать
  useEffect(() => { if (phase === 'unavailable') inputRef.current?.focus(); }, [phase]);

  const search = useCallback(async (query: string) => {
    const text = normalizeQuery(query);
    if (!canSearch(text)) return;
    const g = catalogGuard.status();
    if (g.quota) { setFailure({ kind: 'quota', resetAt: g.quotaResetAt }); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setFailure({ kind: 'offline' }); return; }
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const my = ++seq.current;
    setAsked(text);
    setPhase('loading');
    setFailure(null);
    try {
      const r = await searchAllPlatforms(text, c.signal);
      if (my !== seq.current) return;
      const list = r.candidates.slice(0, MAX_RESULTS);
      setResults(list);
      setRows((d) => {
        const next = { ...d };
        for (const x of list) if (x.inList && !next[x.externalId]) next[x.externalId] = { kind: 'already', focus: false };
        return next;
      });
      setPhase(list.length > 0 ? 'results' : 'noresults');
      setLive(list.length > 0 ? foundGamesText(list.length) : 'Ничего не найдено');
    } catch (e) {
      if (my !== seq.current || c.signal.aborted) return;
      const f = classifySearchError(e, typeof navigator === 'undefined' || navigator.onLine !== false);
      if (f.kind === 'quota') catalogGuard.quota(f.resetAt);
      setFailure(f);
      setPhase((p) => (f.kind === 'unavailable' ? 'unavailable' : p === 'loading' ? 'initial' : p));
    }
  }, []);

  async function add(c: OtherCandidate, confirmDuplicate = false) {
    const value = plat[c.externalId] ?? defaultChip(c.platforms) ?? PLATFORM_NONE;
    const label = value === PLATFORM_NONE ? null : value;
    setRows((r) => ({ ...r, [c.externalId]: { kind: 'adding' } }));
    try {
      const r = await addOtherPlatform({
        kind: 'other_platform', externalSource: 'rawg', externalId: c.externalId, title: c.title, coverUrl: c.coverUrl, releaseDate: c.releaseDate,
        platformLabel: label, ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      });
      if (r.created) {
        addedRef.current.push(r.item);
        setRows((m) => ({ ...m, [c.externalId]: { kind: 'added', label: r.item.platformLabel, focus: true } }));
        setLive(`Добавлено: ${c.title}`);
      } else {
        setRows((m) => ({ ...m, [c.externalId]: { kind: 'already', focus: true } }));
      }
    } catch (e) {
      const dup = parseDuplicate(e);
      setRows((m) => ({ ...m, [c.externalId]: dup ? { kind: 'duplicate', info: dup } : { kind: 'error', text: addErrorText(e) } }));
    }
  }

  const finish = () => onClose(addedRef.current);

  return (
    <Sheet open onClose={finish} title="Играл на другой платформе" className="ps-add-sheet" initialFocus="[data-testid='op-input']" busy={busy}>
      <div className="ps-add" data-testid="op-sheet">
        <p className="ps-sheet__sub ps-add__sub">Найди игру, выбери платформу, на которой играл, и добавь в список. Часы и трофеи не сохраняются.</p>
        <form className="ps-add__form" role="search" onSubmit={(e) => { e.preventDefault(); if (!quota) void search(q); }}>
          <label className="ps-add__field">
            <Icon name="search" size={16} />
            <input
              ref={inputRef} type="search" className="ps-input ps-add__input" data-testid="op-input" value={q} placeholder="Название игры"
              aria-label="Поиск игры в каталоге" autoComplete="off" enterKeyHint="search" maxLength={MAX_QUERY} disabled={quota}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && !quota && (
              <button type="button" className="ps-add__clear" aria-label="Очистить поле" onClick={() => { setQ(''); inputRef.current?.focus(); }}><Icon name="x" size={16} /></button>
            )}
          </label>
          <button
            type="submit" className="ps-btn ps-btn--primary ps-add__go" data-testid="op-submit" disabled={!ok || quota} aria-busy={phase === 'loading' || undefined}
            aria-describedby={!ok ? hintId : undefined}
          >
            {phase === 'loading' ? <><Icon name="loader" size={14} className="ps-nb-spin" />Ищу…</> : 'Найти'}
          </button>
          <span id={hintId} className="ps-sr">Введи минимум 2 символа</span>
        </form>

        <div className="ps-add__body">
          <p className="ps-sr" aria-live="polite">{live}</p>
          {failure?.kind === 'quota' && (
            <div ref={quotaRef} tabIndex={-1} className="ps-rec-banner ps-add__banner" role="status" data-testid="op-quota">
              <Icon name="circle-alert" size={16} />
              <span>Лимит запросов к каталогу исчерпан. Новый поиск станет доступен {failure.resetAt ? (formatDayMonth(failure.resetAt) ?? 'позже') : 'позже'}.</span>
            </div>
          )}
          {(failure?.kind === 'error' || failure?.kind === 'offline') && (
            <div className="ps-rec-banner ps-add__banner" role="alert" data-testid="op-search-error">
              <Icon name="circle-alert" size={16} />
              <span>{failure.kind === 'offline' || !online ? 'Нет соединения. Поиск недоступен офлайн.' : 'Не удалось выполнить поиск.'}</span>
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void search(asked || q)}><Icon name="refresh" size={14} />Повторить</button>
            </div>
          )}

          {phase === 'initial' && (
            <div className="ps-add__state" data-testid="op-search-initial">
              <Icon name="search" size={32} />
              <h3 className="ps-h3">Найди игру</h3>
              <p>Введи название и нажми «Найти». Ищу по всем платформам.</p>
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
            <div className="ps-add__state" data-testid="op-search-empty">
              <Icon name="search-x" size={32} />
              <h3 className="ps-h3">Ничего не найдено</h3>
              <p>По запросу «<span className="ps-add__q">{asked}</span>» ничего не найдено. Проверь написание или введи название по-английски.</p>
            </div>
          )}
          {phase === 'unavailable' && (
            <div className="ps-add__state" data-testid="op-unavailable">
              <Icon name="circle-alert" size={32} />
              <h3 className="ps-h3">Каталог недоступен</h3>
              <p>Поиск временно не работает. Список игр доступен.</p>
            </div>
          )}
          {phase === 'results' && (
            <>
              <ul className="ps-add-list" aria-label="Результаты поиска">
                {results.map((c) => (
                  <OpAddRow
                    key={c.externalId} c={c} row={rows[c.externalId]} value={plat[c.externalId]}
                    onPlat={(v) => setPlat((p) => ({ ...p, [c.externalId]: v }))}
                    onAdd={(confirm) => void add(c, confirm)}
                    onCancel={() => setRows((m) => { const n = { ...m }; delete n[c.externalId]; return n; })}
                    onOpenGame={finish}
                  />
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
          <button type="button" className="ps-btn ps-btn--ghost" data-testid="op-close" disabled={busy} onClick={finish}>Закрыть</button>
        </div>
      </div>
    </Sheet>
  );
}

function OpAddRow({
  c, row, value, onPlat, onAdd, onCancel, onOpenGame,
}: {
  c: OtherCandidate; row: Row | undefined; value: string | undefined; onPlat: (v: string) => void; onAdd: (confirm: boolean) => void; onCancel: () => void; onOpenGame: () => void;
}) {
  // пакет 5: те же чипы Switch / Xbox / PC / «нет», что в окне записи; по умолчанию — узнанная платформа RAWG
  const def = useMemo(() => defaultChip(c.platforms), [c.platforms]);
  const cur = value ?? def ?? PLATFORM_NONE;
  const curLabel = cur === PLATFORM_NONE ? undefined : cur;
  const adding = row?.kind === 'adding';
  const doneRef = useRef<HTMLSpanElement>(null);
  const warnRef = useRef<HTMLDivElement>(null);
  const focusDone = (row?.kind === 'added' || row?.kind === 'already') && row.focus;
  useEffect(() => { if (focusDone) doneRef.current?.focus(); }, [focusDone]);
  const dup = row?.kind === 'duplicate';
  useEffect(() => { if (dup) warnRef.current?.focus(); }, [dup]);
  const hasPlat = cur !== PLATFORM_NONE && !!curLabel;

  return (
    <li className="ps-add-row ps-add-row--op" data-testid="op-add-row" data-state={row?.kind ?? 'idle'} aria-busy={adding || undefined}>
      <Cover url={c.coverUrl} title={c.title} className="ps-add-row__cover" />
      <div className="ps-add-row__text">
        <span className="ps-add-row__title" title={c.title}>{c.title}</span>
        <span className="ps-add-row__meta">{searchReleaseText(c.releaseDate)}</span>
      </div>
      <div className="ps-add-row__act ps-add-row__act--op">
        {row?.kind === 'added' || row?.kind === 'already' ? (
          <span ref={doneRef} tabIndex={-1} className="ps-add-row__done" data-testid="op-add-done" data-kind={row.kind}>
            <Icon name="check" size={14} />
            {row.kind === 'already' ? 'Уже в списке' : row.label ? `Добавлено · ${row.label}` : 'Добавлено'}
          </span>
        ) : adding ? (
          <span className="ps-add-row__done" role="status"><Icon name="loader" size={14} className="ps-nb-spin" />Добавляю…</span>
        ) : (
          <>
            <button
              type="button" className="ps-btn ps-btn--ghost ps-op-addbtn" data-testid="op-add-btn" disabled={dup}
              aria-label={hasPlat ? `Добавить в список: ${c.title}, платформа ${curLabel}` : `Добавить в список: ${c.title}`} onClick={() => onAdd(false)}
            >
              <Icon name="plus" size={14} />Добавить
            </button>
          </>
        )}
      </div>
      {!(row?.kind === 'added' || row?.kind === 'already' || adding) && (
        <div className="ps-opd__chips ps-op-plats" role="group" aria-label={`Платформа: ${c.title}`} data-testid="op-platform">
          {[...PLATFORM_CHIPS, PLATFORM_NONE].map((p) => (
            <button
              key={p || 'none'} type="button" className="ps-filterchip ps-chip ps-opd__chip" aria-pressed={cur === p} data-platform={p || 'none'} disabled={dup}
              onClick={() => onPlat(p)}
            >{p || 'нет'}</button>
          ))}
        </div>
      )}
      {row?.kind === 'error' && <p className="ps-add-row__err" role="alert"><Icon name="circle-alert" size={14} />{row.text}</p>}
      {row?.kind === 'duplicate' && (
        <div ref={warnRef} tabIndex={-1} className="ps-add-warn" role="group" aria-label={`Такая игра уже есть: ${c.title}`} data-testid="op-warn">
          <h4 className="ps-add-warn__h"><Icon name="circle-alert" size={16} />Такая игра уже есть</h4>
          {row.info.game && <p className="ps-add-warn__t">В твоей библиотеке PSN: «{row.info.game.name}»</p>}
          {row.info.planned && <p className="ps-add-warn__t">В Плане: «{row.info.planned.title}»</p>}
          <p className="ps-add-warn__t">Если ты играл и на PlayStation, отдельная запись здесь не нужна.</p>
          <div className="ps-add-warn__btns">
            {row.info.game && <Link href={`/?game=${row.info.game.gameId}`} className="ps-link" onClick={onOpenGame}>Открыть в библиотеке</Link>}
            <button type="button" className="ps-btn ps-btn--ghost" data-testid="op-warn-confirm" aria-label={`Всё равно добавить: ${c.title}`} onClick={() => onAdd(true)}>Всё равно добавить</button>
            <button type="button" className="ps-btn ps-btn--ghost" data-testid="op-warn-cancel" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      )}
    </li>
  );
}
