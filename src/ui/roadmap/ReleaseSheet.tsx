'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { ApiError, mutationError, searchCatalog } from './api';
import {
  candidateMeta, catalogFail, emptyValues, filterCandidates, isRealDate, outsideYear, toPlannedBody, validateRelease, valuesFromPlanned,
  type CatalogCandidateView, type CatalogFailKind, type PlannedBody, type ReleaseValues,
} from './model';
import { FieldError, Spinner, Thumb } from './parts';
import type { PlannedGameDto } from '@/server/roadmap/types';

type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; list: CatalogCandidateView[] }
  | { state: 'fail'; kind: CatalogFailKind; text: string };

function CoverPreview({ url }: { url: string }) {
  const [status, setStatus] = useState<{ url: string; s: 'ok' | 'bad' } | null>(null);
  const cur = status?.url === url ? status.s : 'loading';
  return (
    <div className="ps-rm-prev" aria-live="polite">
      {cur === 'bad' ? (
        <span className="ps-rm-prev__bad">Не удалось загрузить картинку</span>
      ) : (
        <>
          {cur === 'loading' && <span className="ps-skeleton ps-rm-prev__sk" aria-hidden="true" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- превью введённой ссылки, внешний хост неизвестен */}
          <img src={url} alt="" width={48} height={64} referrerPolicy="no-referrer" onLoad={() => setStatus({ url, s: 'ok' })} onError={() => setStatus({ url, s: 'bad' })} hidden={cur !== 'ok'} />
        </>
      )}
    </div>
  );
}

/** Диалог «Добавить игру» / «Изменить игру»: поиск в RAWG (подсказка) + форма ручного ввода (всегда доступна). */
export function ReleaseSheet({
  game, year, onClose, onSubmit,
}: { game: PlannedGameDto | null; year: number; onClose: () => void; onSubmit: (body: PlannedBody, withExternal: boolean) => Promise<void> }) {
  const edit = game !== null;
  const id = useId();
  const [initial] = useState<ReleaseValues>(() => (game ? valuesFromPlanned(game) : emptyValues()));
  const [v, setV] = useState<ReleaseValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [q, setQ] = useState('');
  const [onlyPs, setOnlyPs] = useState(true);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [retry, setRetry] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(game?.externalId ?? null);

  useEffect(() => {
    // Sheet ставит фокус на контейнер диалога после монтирования: переносим на нужное поле следом
    const t = setTimeout(() => {
      // не перехватываем фокус, если пользователь уже что-то выбрал внутри диалога
      if ((document.activeElement as HTMLElement | null)?.getAttribute('role') === 'dialog') (edit ? titleRef.current : searchRef.current)?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [edit]);

  useEffect(() => {
    const text = q.trim();
    if (edit || text.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setSearch({ state: 'loading' });
      searchCatalog(text, ctl.signal)
        .then((r) => { if (!ctl.signal.aborted) setSearch({ state: 'ok', list: r.candidates }); })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) return;
          const f = catalogFail(e instanceof ApiError ? e.reason : undefined);
          setSearch({ state: 'fail', ...f });
        });
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, edit, retry]);

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const errors = validateRelease(v);
  const hasErr = Object.keys(errors).length > 0;
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);
  const hasDate = !v.noDate && isRealDate(v.date.trim());
  const set = (p: Partial<ReleaseValues>) => { setV((x) => ({ ...x, ...p })); setServerErr(null); };

  function requestClose() {
    if (dirty && !busy) setConfirmClose(true);
    else onClose();
  }
  function pick(c: CatalogCandidateView) {
    setPicked(c.externalId);
    set({
      title: c.title.slice(0, 120), noDate: c.releaseDate === null, date: c.releaseDate ?? '', coverUrl: c.coverUrl ?? '',
      externalId: c.externalId, want: c.releaseDate === null ? false : v.want,
    });
  }

  async function submit() {
    setSubmitted(true);
    if (hasErr) return;
    setBusy(true);
    setServerErr(null);
    try {
      await onSubmit(toPlannedBody(v, !edit), !edit);
      onClose();
    } catch (e) {
      setServerErr(e instanceof ApiError && e.code === 'planned_duplicate' ? mutationError(e) : 'Не удалось сохранить игру. Повтори');
      setBusy(false);
    }
  }

  const results = search.state === 'ok' ? filterCandidates(search.list, onlyPs) : [];
  const typed = q.trim().length >= 2;

  return (
    <Sheet open onClose={requestClose} title={edit ? 'Изменить игру' : 'Добавить игру в план'}>
      <div className="ps-rm-dlg">
        {!edit && (
          <div className="ps-rm-sect">
            <label className="ps-rm-lbl" htmlFor={`${id}-q`}>Найти в каталоге</label>
            <div className="ps-rm-search">
              <span className="ps-search ps-rm-search__f">
                <Icon name="search" size={16} />
                <input
                  id={`${id}-q`} ref={searchRef} type="search" className="ps-search__input" placeholder="Название игры…" value={q} autoComplete="off"
                  onChange={(e) => setQ(e.target.value)}
                />
              </span>
              <button type="button" className="ps-btn ps-btn--sm ps-rm-pschip" aria-pressed={onlyPs} onClick={() => setOnlyPs((x) => !x)}>Только PlayStation</button>
            </div>
            {!typed ? (
              <p className="ps-rm-muted">Начни вводить название, чтобы найти игру в каталоге</p>
            ) : search.state === 'loading' || search.state === 'idle' ? (
              <ul className="ps-rm-cands" aria-busy="true" aria-hidden="true">{[0, 1, 2].map((i) => <li key={i} className="ps-skeleton ps-rm-cand--sk" />)}</ul>
            ) : search.state === 'fail' ? (
              search.kind === 'not_configured' ? (
                <p className="ps-rm-muted ps-rm-muted--ic"><Icon name="info" size={12} />{search.text}</p>
              ) : (
                <div className="ps-rm-warn" role="status" data-testid="rm-catalog-fail">
                  <Icon name="alert" size={16} />
                  <p>{search.text}</p>
                  <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setSearch({ state: 'loading' }); setRetry((n) => n + 1); }}>Повторить поиск</button>
                </div>
              )
            ) : results.length === 0 ? (
              <p className="ps-rm-muted ps-rm-muted--ic" role="status">
                <Icon name="search-x" size={16} />
                {search.list.length > 0 && onlyPs ? (
                  <span>Нет на PlayStation. <button type="button" className="ps-link" onClick={() => setOnlyPs(false)}>Показать все платформы</button></span>
                ) : <span>В каталоге ничего не найдено. Заполни форму ниже вручную.</span>}
              </p>
            ) : (
              <>
                <p className="ps-sr" aria-live="polite">Найдено: {results.length}</p>
                <ul className="ps-rm-cands" aria-label="Результаты поиска в каталоге">
                  {results.map((c) => (
                    <li key={c.externalId}>
                      <button type="button" className="ps-rm-cand" aria-pressed={picked === c.externalId} onClick={() => pick(c)}>
                        <Thumb url={c.coverUrl} title={c.title} w={40} h={54} />
                        <span className="ps-rm-cand__tx"><b title={c.title}>{c.title}</b><small>{candidateMeta(c)}</small></span>
                        {picked === c.externalId ? <Icon name="check" size={16} /> : <span className="ps-rm-cand__go">Выбрать</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="ps-rm-attr">Данные: <a href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="Данные: RAWG (откроется в новой вкладке)">RAWG<Icon name="external-link" size={12} /></a></p>
          </div>
        )}

        {!edit && <div className="ps-rm-or"><span>Или введи вручную</span></div>}
        {v.externalId && (
          <p className="ps-rm-src">
            Из каталога RAWG
            {!edit && <button type="button" className="ps-link" onClick={() => { set({ externalId: null }); setPicked(null); }}>Сбросить выбор</button>}
          </p>
        )}

        <form className="ps-rm-form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="ps-rm-fld">
            <label className="ps-rm-lbl" htmlFor={`${id}-t`}>Название</label>
            <input
              id={`${id}-t`} ref={titleRef} className="ps-rm-text" type="text" maxLength={120} placeholder="Название игры" value={v.title} autoComplete="off"
              aria-invalid={show('title') ? 'true' : undefined} aria-describedby={show('title') ? `${id}-te` : undefined}
              onChange={(e) => set({ title: e.target.value })}
            />
            {show('title') && <FieldError id={`${id}-te`}>{errors.title}</FieldError>}
          </div>
          <div className="ps-rm-fld">
            <label className="ps-rm-lbl" htmlFor={`${id}-d`}>Дата релиза</label>
            <input
              id={`${id}-d`} className="ps-rm-text" type="date" value={v.noDate ? '' : v.date} disabled={v.noDate}
              aria-invalid={show('date') ? 'true' : undefined} aria-describedby={show('date') ? `${id}-de` : undefined}
              onChange={(e) => set({ date: e.target.value })}
            />
            <label className="ps-rm-check">
              <input type="checkbox" checked={v.noDate} onChange={(e) => set({ noDate: e.target.checked, date: '', want: e.target.checked ? false : v.want })} />
              <span>Дата пока неизвестна</span>
            </label>
            {show('date') && <FieldError id={`${id}-de`}>{errors.date}</FieldError>}
          </div>
          <div className="ps-rm-fld">
            <label className="ps-rm-lbl" htmlFor={`${id}-c`}>Обложка</label>
            <div className="ps-rm-cover">
              <input
                id={`${id}-c`} className="ps-rm-text" type="url" inputMode="url" placeholder="https://…" value={v.coverUrl} autoComplete="off"
                aria-invalid={show('cover') ? 'true' : undefined} aria-describedby={show('cover') ? `${id}-ce` : undefined}
                onChange={(e) => set({ coverUrl: e.target.value })}
              />
              {v.coverUrl.trim() && /^https:\/\/\S+$/i.test(v.coverUrl.trim()) && <CoverPreview url={v.coverUrl.trim()} />}
            </div>
            {show('cover') && <FieldError id={`${id}-ce`}>{errors.cover}</FieldError>}
          </div>
          <div className="ps-rm-fld">
            <label className="ps-rm-lbl" htmlFor={`${id}-h`}>Часов на прохождение</label>
            <span className="ps-rm-input ps-rm-input--sfx ps-rm-input--w" data-invalid={show('hours') ? 'true' : undefined}>
              <input
                id={`${id}-h`} type="text" inputMode="decimal" value={v.hours} autoComplete="off"
                aria-invalid={show('hours') ? 'true' : undefined} aria-describedby={show('hours') ? `${id}-he` : `${id}-hh`}
                onChange={(e) => set({ hours: e.target.value })}
              />
              <span className="ps-rm-sfx" aria-hidden="true">ч</span>
            </span>
            {show('hours') ? <FieldError id={`${id}-he`}>{errors.hours}</FieldError> : <p className="ps-rm-muted" id={`${id}-hh`}>Без часов игра не попадёт на таймлайн</p>}
          </div>
          <div className="ps-rm-fld">
            <label className="ps-rm-check" data-disabled={!hasDate || undefined}>
              <input type="checkbox" checked={v.want && hasDate} disabled={!hasDate} onChange={(e) => set({ want: e.target.checked })} aria-describedby={!hasDate ? `${id}-wh` : undefined} />
              <span>Хочу пройти на релизе</span>
            </label>
            {!hasDate && <p className="ps-rm-muted" id={`${id}-wh`}>Нужна дата релиза</p>}
            {show('want') && hasDate === false && v.want && <FieldError>{errors.want}</FieldError>}
          </div>
          {hasDate && outsideYear(v.date.trim(), year) && (
            <p className="ps-hint" role="note"><Icon name="info" size={14} />Эта дата вне {year} года: в план на {year} игра не попадёт.</p>
          )}
          {serverErr && <p className="ps-rm-ferr ps-rm-ferr--form" role="alert"><Icon name="circle-alert" size={14} /><span>{serverErr}</span></p>}
          {confirmClose ? (
            <div className="ps-rm-confirm" role="alertdialog" aria-label="Закрыть без сохранения?">
              <p>Закрыть без сохранения?</p>
              <button type="button" className="ps-btn ps-btn--danger" onClick={onClose}>Закрыть</button>
              <button type="button" className="ps-btn ps-btn--ghost" autoFocus onClick={() => setConfirmClose(false)}>Остаться</button>
            </div>
          ) : (
            <div className="ps-rm-dlg__btns">
              <button type="submit" className="ps-btn ps-btn--primary" disabled={busy || !v.title.trim()} aria-busy={busy || undefined}>
                {busy ? <><Spinner />Сохраняю…</> : edit ? 'Сохранить' : 'Добавить в план'}
              </button>
              <button type="button" className="ps-btn ps-btn--ghost" onClick={requestClose}>Отмена</button>
            </div>
          )}
        </form>
      </div>
    </Sheet>
  );
}
