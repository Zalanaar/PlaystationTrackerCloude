'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, StatusIcon } from '../icons';
import { useToast } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import { Cover } from '../collection/Cover';
import { BlockHead } from '../collection/Chronicle';
import { parseDuplicate } from '../collection/manual';
import { addOtherPlatform, fetchOtherPlatforms, removeOtherPlatform, restoreBody, type OtherPlatformGame } from './api';
import { gamesText, OTHER_STATUS_ORDER, otherGroups, otherStats } from './block';
import { addedToastText, mergeOther, removedToastText, sortOther } from './model';

const AddOtherPlatformSheet = dynamic(() => import('./AddOtherPlatformSheet').then((m) => m.AddOtherPlatformSheet), { ssr: false });
const OtherPlatformDialog = dynamic(() => import('./OtherPlatformDialog').then((m) => m.OtherPlatformDialog), { ssr: false });

/**
 * Пакет 5 (спека 5.1, 5.5, 5.7, 5.9): блок «Игры с других платформ» в самом низу хроники Коллекции.
 * Сводка только по этим записям; группы по году смены статуса ○/✕, остальное — «Не распределено». Строка открывает окно записи.
 */
export function OtherPlatformsBlock() {
  const toast = useToast();
  const [items, setItems] = useState<OtherPlatformGame[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchOtherPlatforms(signal);
      if (signal?.aborted) return;
      setItems(sortOther(r.items));
      setFailed(false);
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => void reload(ac.signal), 0);
    return () => { clearTimeout(t); ac.abort(); };
  }, [reload]);

  // строка могла переехать в другую группу (новый год): прежний узел размонтирован, фокус возвращаем по id
  function closeDialog() {
    const id = openId;
    setOpenId(null);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="op-row"][data-id="${id}"] [data-testid="op-open"]`);
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    });
  }

  const replace = (g: OtherPlatformGame) => setItems((l) => (l ?? []).map((x) => (x.id === g.id ? g : x)));

  async function restore(g: OtherPlatformGame) {
    try {
      let r;
      try { r = await addOtherPlatform(restoreBody(g)); } catch (e) {
        if (!parseDuplicate(e)) throw e;
        r = await addOtherPlatform(restoreBody(g, true));
      }
      // статус, оценка и заметка не возвращаются: meta удалена вместе с записью
      if (alive.current) setItems((l) => mergeOther(l ?? [], [r.item]));
    } catch {
      toast({ text: 'Не удалось вернуть. Добавь игру заново через «+ Другая платформа».', kind: 'error', alert: true });
    }
  }

  async function remove(g: OtherPlatformGame) {
    try {
      await removeOtherPlatform(g.id);
    } catch {
      toast({ text: 'Не удалось удалить. Повтори.', kind: 'error', alert: true });
      return;
    }
    if (!alive.current) return;
    setOpenId(null);
    setItems((l) => (l ?? []).filter((x) => x.id !== g.id));
    requestAnimationFrame(() => addRef.current?.focus({ preventScroll: true }));
    toast({ text: removedToastText(g.title), kind: 'info', ttl: 8000, action: { label: 'Вернуть', run: () => void restore(g) } });
  }

  function closeAdd(added: OtherPlatformGame[]) {
    setAdding(false);
    if (added.length > 0) {
      setItems((l) => mergeOther(l ?? [], added));
      toast({ text: addedToastText(added.map((a) => a.title)), kind: 'info', ttl: 6000 });
    }
    requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) addRef.current?.focus(); });
  }

  const list = items ?? [];
  const open = openId === null ? null : list.find((x) => x.id === openId) ?? null;
  const st = otherStats(list);
  const groups = otherGroups(list);

  return (
    <section className="ps-block ps-opb" id="other-platforms" aria-labelledby="opb-title" data-testid="op-block">
      <BlockHead id="opb-title" title="Игры с других платформ" count={items ? list.length : undefined}>
        <button ref={addRef} type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-opb__add" data-testid="op-add" aria-haspopup="dialog" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />Другая платформа
        </button>
      </BlockHead>

      {failed && !items && (
        <p className="ps-inline-error ps-block-error" role="status" data-testid="op-error">
          <Icon name="circle-alert" size={18} /><span>Не удалось загрузить игры с других платформ.</span>
          <button type="button" className="ps-link" aria-label="Повторить загрузку игр с других платформ" onClick={() => void reload()}>Повторить</button>
        </p>
      )}

      {items && list.length === 0 && (
        <p className="ps-block__note" data-testid="op-empty">Отметь игры, пройденные на Switch, Xbox или ПК. В Статистику, Итоги и счётчики они не входят, и мы не предлагаем их в «У тебя нет».</p>
      )}

      {list.length > 0 && (
        <>
          <dl className="ps-opb__stats" data-testid="op-stats" aria-label="Сводка по играм с других платформ">
            <div><dt>Всего</dt><dd className="num">{gamesText(st.total)}</dd></div>
            <div><dt>Платформы</dt><dd>{st.byPlatform.map((p) => `${p.label} ${p.n}`).join(' · ')}</dd></div>
            <div>
              <dt>Статусы</dt>
              <dd className="ps-opb__sts">
                {OTHER_STATUS_ORDER.filter((s) => st.byStatus[s] > 0).map((s) => (
                  <span key={s} className="ps-opb__st" data-status={s} aria-label={`${STATUS_META[s].label}: ${st.byStatus[s]}`}><StatusIcon status={s} size={14} /><span className="num" aria-hidden="true">{st.byStatus[s]}</span></span>
                ))}
                {OTHER_STATUS_ORDER.every((s) => st.byStatus[s] === 0) && 'не заданы'}
              </dd>
            </div>
            <div><dt>Средняя оценка</dt><dd className="num">{st.avgRating === null ? 'нет' : `${String(st.avgRating).replace('.', ',')}/10`}</dd></div>
          </dl>
          {groups.map((gr) => (
            <div key={gr.key} className="ps-opb__group" data-testid="op-group" data-year={gr.year ?? 'none'}>
              <h3 className="ps-opb__gh" id={gr.key}>{gr.title} <span className="ps-block__cnt ps-num">{gr.items.length}</span></h3>
              <ul className="ps-oplist" aria-labelledby={gr.key}>
                {gr.items.map((g) => (
                  <li key={g.id} className="ps-op ps-op--b" data-testid="op-row" data-id={g.id}>
                    <Cover url={g.coverUrl} title={g.title} className="ps-op__cover" />
                    <button type="button" className="ps-op__open" data-testid="op-open" aria-haspopup="dialog" onClick={() => setOpenId(g.id)}>
                      <span className="ps-op__title" title={g.title}>{g.title}</span>
                      <span className="ps-op__meta">
                        {g.platformLabel
                          ? <span className="ps-plat-tag" data-testid="op-row-platform">{g.platformLabel}</span>
                          : <span className="ps-op__none" data-testid="op-row-platform">Платформа не указана</span>}
                        {g.status && <span className="ps-opb__st" data-status={g.status} data-testid="op-row-status"><StatusIcon status={g.status} size={14} />{STATUS_META[g.status].label}</span>}
                        {g.rating !== null && <span className="ps-op__rate num" data-testid="op-row-rating">{g.rating}/10</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {adding && <AddOtherPlatformSheet onClose={closeAdd} />}
      <OtherPlatformDialog game={open} onClose={closeDialog} onChanged={replace} onRemove={(g) => void remove(g)} />
    </section>
  );
}
