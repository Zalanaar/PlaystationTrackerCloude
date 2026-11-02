'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import '../recommend.css';
import { EmptyState } from '../EmptyState';
import { Icon } from '../icons';
import { useToast } from '../primitives/Toast';
import { useOnline } from '../collection/useSuggest';
import { addOtherPlatform, fetchOtherPlatforms, removeOtherPlatform, restoreBody, type OtherPlatformGame } from './api';
import { parseDuplicate } from '../collection/manual';
import { setOtherCount } from './countStore';
import { FILTER_MIN, PAGE_SIZE, addedToastText, filterOther, mergeOther, moreText, removedToastText, sortOther } from './model';
import { OtherPlatformRow } from './OtherPlatformRow';
import { OtherPlatformsSkeleton } from './OtherPlatformsSkeleton';

const AddOtherPlatformSheet = dynamic(() => import('./AddOtherPlatformSheet').then((m) => m.AddOtherPlatformSheet), { ssr: false });

type Load = 'loading' | 'ready' | 'error';
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLLAPSE_MS = 200;

/** Экран «Играл на другой платформе» (design-system §19c.2–19c.6). Данные только по GET /api/manual-games?kind=other_platform. */
export function OtherPlatformsPage() {
  const toast = useToast();
  const online = useOnline();
  const [items, setItems] = useState<OtherPlatformGame[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [adding, setAdding] = useState(false);
  const [collapsing, setCollapsing] = useState<ReadonlySet<number>>(new Set());
  const itemsRef = useRef<OtherPlatformGame[]>([]);
  const addRef = useRef<HTMLButtonElement>(null);
  const emptyAddRef = useRef<HTMLButtonElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const acRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { itemsRef.current = items; setOtherCount(load === 'ready' || items.length > 0 ? items.length : null); }, [items, load]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const r = await fetchOtherPlatforms(ac.signal);
      if (ac.signal.aborted) return;
      setItems(sortOther(r.items));
      setLoad('ready');
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      // последние загруженные данные остаются на экране
      setLoad('error');
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => { clearTimeout(t); acRef.current?.abort(); };
  }, [reload]);

  // два кадра: React успевает отрисовать новое состояние (пустое/следующая строка), потом ставим фокус
  const focusSoon = (get: () => HTMLElement | null | undefined) => requestAnimationFrame(() => requestAnimationFrame(() => (get() ?? addRef.current)?.focus()));

  // ---------- удаление: без диалога, с «Вернуть» (19c.5) ----------
  async function restore(g: OtherPlatformGame) {
    try {
      let r;
      try {
        r = await addOtherPlatform(restoreBody(g));
      } catch (e) {
        // исходное добавление могло идти с подтверждением дубля: пользователь его уже принял
        if (!parseDuplicate(e)) throw e;
        r = await addOtherPlatform(restoreBody(g, true));
      }
      if (!alive.current) return;
      setItems((l) => mergeOther(l, [r.item]));
      setShown((n) => Math.max(n, PAGE_SIZE));
      setQ('');
      focusSoon(() => document.querySelector<HTMLElement>(`[data-id="${r.item.id}"] [data-testid="op-remove"]`));
    } catch {
      toast({ text: 'Не удалось вернуть. Найди игру через «Играл на другой платформе».', kind: 'error', alert: true });
    }
  }

  async function remove(g: OtherPlatformGame) {
    if (collapsing.has(g.id)) return;
    // фокус: на корзину следующей строки, иначе предыдущей, иначе на кнопку добавления
    const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="op-row"]:not([data-collapsing])'));
    const at = btns.findIndex((el) => el.dataset.id === String(g.id));
    const neighbor = btns[at + 1] ?? btns[at - 1];
    const neighborId = neighbor?.dataset.id;
    setCollapsing((s) => new Set(s).add(g.id));
    const wait = new Promise<void>((res) => setTimeout(res, reducedMotion() ? 0 : COLLAPSE_MS));
    try {
      await Promise.all([removeOtherPlatform(g.id), wait]); // removed: false (гонка) тоже успех
    } catch {
      if (!alive.current) return;
      setCollapsing((s) => { const n = new Set(s); n.delete(g.id); return n; });
      toast({ text: 'Не удалось убрать. Повтори.', kind: 'error', alert: true, action: { label: 'Повторить', run: () => void remove(g) } });
      return;
    }
    if (!alive.current) return;
    setCollapsing((s) => { const n = new Set(s); n.delete(g.id); return n; });
    const left = itemsRef.current.filter((x) => x.id !== g.id);
    setItems(left);
    focusSoon(() => (neighborId ? document.querySelector<HTMLElement>(`[data-id="${neighborId}"] [data-testid="op-remove"]`) : left.length === 0 ? (emptyAddRef.current ?? addRef.current) : addRef.current));
    toast({ text: removedToastText(g.title), kind: 'info', ttl: 8000, action: { label: 'Вернуть', run: () => void restore(g) } });
  }

  function closeAdd(added: OtherPlatformGame[]) {
    setAdding(false);
    if (added.length > 0) {
      setItems((l) => mergeOther(l, added));
      setLoad('ready');
      toast({ text: addedToastText(added.map((a) => a.title)), kind: 'info', ttl: 6000 });
    }
    requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) addRef.current?.focus(); });
  }

  const total = items.length;
  const showFilter = total >= FILTER_MIN;
  const list = showFilter ? filterOther(items, q) : items;
  const visible = list.slice(0, shown);
  const filtering = showFilter && q.trim() !== '';
  const ready = load === 'ready' || (load === 'error' && total > 0);

  return (
    <div className="ps-oppage">
      <header className="ps-pagehead ps-pagehead--op">
        <div className="ps-pagehead--op__text">
          <h1 ref={headRef} tabIndex={-1} className="ps-h1">Играл на другой платформе</h1>
          <p className="ps-op-lead">
            Игры, которые ты проходил не на PlayStation. Мы не будем предлагать их в «У тебя нет» и в Плане. В Статистику, Итоги и Бэклог они не входят.
          </p>
        </div>
        <button
          ref={addRef} type="button" className="ps-btn ps-btn--primary ps-op-add" data-testid="op-add" aria-haspopup="dialog"
          aria-label="Играл на другой платформе: добавить игру" onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={16} />
          <span className="ps-op-add__long">Играл на другой платформе</span>
          <span className="ps-op-add__short">Добавить игру</span>
        </button>
      </header>

      {!online && (
        <div className="ps-rec-banner" role="status" data-testid="op-offline">
          <Icon name="circle-alert" size={16} /><span>Нет соединения. Список может быть неактуален.</span>
        </div>
      )}
      {load === 'error' && (
        <div className="ps-rec-banner" role="alert" data-testid="op-error">
          <Icon name="circle-alert" size={16} /><span>Не удалось загрузить список.</span>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" data-testid="op-retry" onClick={() => { if (total === 0) setLoad('loading'); void reload(); }}>
            <Icon name="refresh" size={14} />Повторить
          </button>
        </div>
      )}

      {load === 'loading' && <OtherPlatformsSkeleton />}

      {ready && total === 0 && (
        <div data-testid="op-empty">
          <EmptyState icon={<Icon name="library" size={32} />} title="Здесь будут игры не с PlayStation">
            <p className="ps-empty__text">Отметь то, что уже проходил на Xbox, Nintendo Switch или ПК. Мы перестанем предлагать эти игры в «У тебя нет» и в Плане.</p>
            <p className="ps-op-note">Это просто список: часы, трофеи и статусы не сохраняются, в Статистику и Итоги он не попадает.</p>
            <button ref={emptyAddRef} type="button" className="ps-btn ps-btn--primary" data-testid="op-empty-add" aria-haspopup="dialog" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} />Играл на другой платформе
            </button>
          </EmptyState>
        </div>
      )}

      {ready && total > 0 && (
        <>
          {showFilter && (
            <div className="ps-op-filter">
              <label className="ps-add__field ps-op-filter__field">
                <Icon name="search" size={16} />
                <input
                  type="search" className="ps-input ps-add__input" data-testid="op-filter" value={q} placeholder="Фильтр по названию"
                  aria-label="Фильтр списка по названию" autoComplete="off" onChange={(e) => { setQ(e.target.value); setShown(PAGE_SIZE); }}
                />
              </label>
              <p className="ps-sr" aria-live="polite">{filtering ? `Найдено ${list.length}` : ''}</p>
            </div>
          )}
          <p className="ps-op-sub">
            {filtering ? <>Найдено: <span className="num">{list.length}</span> из <span className="num">{total}</span></> : <>В списке: <span className="num">{total}</span></>}
          </p>
          {list.length === 0 ? (
            <div className="ps-op-nores" data-testid="op-nores">
              <Icon name="search-x" size={32} />
              <p>Ничего не найдено по «<span className="ps-add__q">{q.trim()}</span>»</p>
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => { setQ(''); }}>Очистить фильтр</button>
            </div>
          ) : (
            <ul className="ps-oplist" data-testid="op-list" aria-label="Игры, в которые играл на других платформах">
              {visible.map((g) => <OtherPlatformRow key={g.id} game={g} collapsing={collapsing.has(g.id)} onRemove={(x) => void remove(x)} />)}
            </ul>
          )}
          {list.length > shown && (
            <button type="button" className="ps-btn ps-btn--ghost ps-op-more" data-testid="op-more" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              {moreText(list.length - shown)}
            </button>
          )}
        </>
      )}

      {adding && <AddOtherPlatformSheet onClose={closeAdd} />}
    </div>
  );
}
