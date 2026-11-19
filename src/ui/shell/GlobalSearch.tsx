'use client';
// Идея 2 (аудит UX): поиск игры из любого раздела. На Коллекции и Бэклоге кнопка «Найти игру» открывает их собственный
// поиск; в остальных разделах — этот лист: поиск по коллекции (GET /api/games?q=), строка ведёт в окно игры (/?game=id),
// где меняется статус и игра ставится в план.
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { fetchGames } from '../collection/api';
import { Cover } from '../collection/Cover';
import { formatHours } from '../format';
import { Sheet } from '../primitives/Sheet';
import { STATUS_META } from '../tokens';

export const GLOBAL_SEARCH_LIMIT = 12;
const DEBOUNCE_MS = 250;

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; items: GameItem[]; q: string } | { kind: 'error' };

export function globalSearchMeta(g: Pick<GameItem, 'status' | 'platform' | 'hours'>): string {
  return [STATUS_META[g.status ?? 'none'].label, g.platform, g.hours > 0 ? formatHours(g.hours) : null].filter(Boolean).join(' · ');
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const listId = useId();
  const term = q.trim();

  useEffect(() => {
    if (!open || term.length < 2) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setState({ kind: 'loading' });
      const sp = new URLSearchParams({ q: term, limit: String(GLOBAL_SEARCH_LIMIT), sort: 'last_played' });
      fetchGames(sp, ac.signal).then(
        (r) => { if (!ac.signal.aborted) setState({ kind: 'ok', items: r.items, q: term }); },
        () => { if (!ac.signal.aborted) setState({ kind: 'error' }); },
      );
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [open, term]);

  const close = () => { onClose(); setQ(''); setState({ kind: 'idle' }); };
  const shown = term.length >= 2 ? state : { kind: 'idle' as const };

  return (
    <Sheet open={open} onClose={close} title="Найти игру" initialFocus=".ps-gsearch__input">
      <div className="ps-gsearch" data-testid="global-search">
        <input
          type="search" className="ps-input ps-gsearch__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название игры"
          aria-label="Название игры в коллекции" aria-controls={listId} enterKeyHint="search" autoComplete="off"
        />
        <div id={listId} role="status" aria-live="polite" className="ps-gsearch__state">
          {shown.kind === 'idle' && <p className="ps-gsearch__hint">Минимум 2 буквы. Откроется окно игры: статус, оценка, план.</p>}
          {shown.kind === 'loading' && <p className="ps-gsearch__hint">Ищу…</p>}
          {shown.kind === 'error' && <p className="ps-gsearch__hint">Не удалось найти: нет связи с сервером.</p>}
          {shown.kind === 'ok' && shown.items.length === 0 && <p className="ps-gsearch__hint" data-testid="global-search-empty">В коллекции ничего не нашлось.</p>}
        </div>
        {shown.kind === 'ok' && shown.items.length > 0 && (
          <ul className="ps-gsearch__list" aria-label={`Найдено: ${shown.items.length}`}>
            {shown.items.map((g) => (
              <li key={g.id}>
                <Link href={`/?game=${g.id}`} className="ps-gsearch__row" data-testid="global-search-row" onClick={close}>
                  <Cover url={g.coverUrl} title={g.title} className="ps-gsearch__cover" w={40} />
                  <span className="ps-gsearch__txt"><b>{g.title}</b><small>{globalSearchMeta(g)}</small></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
