'use client';
// П.7 (t281u): «Обзор» тоньше — история и «Подробнее» (даты, теги, версии, длительность, управление) свёрнуты.
// Раскрытие запоминается (localStorage), чтобы не открывать каждый раз.
import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '../../icons';

export const FOLDS_KEY = 'ps-gd-folds';
type Folds = Record<string, boolean>;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const read = (): string => { try { return localStorage.getItem(FOLDS_KEY) ?? '{}'; } catch { return '{}'; } };
const parse = (raw: string): Folds => { try { const v = JSON.parse(raw) as unknown; return v && typeof v === 'object' ? (v as Folds) : {}; } catch { return {}; } };

function setFold(id: string, open: boolean) {
  const next = { ...parse(read()), [id]: open };
  try { localStorage.setItem(FOLDS_KEY, JSON.stringify(next)); } catch { /* приватный режим */ }
  listeners.forEach((fn) => fn());
}

/** `force` — раскрыто всегда (у убранной игры «Вернуть в коллекцию» не прячем). */
export function Fold({ id, title, hint, children, testId, force = false }: { id: string; title: string; hint?: string; children: ReactNode; testId?: string; force?: boolean }) {
  const raw = useSyncExternalStore(subscribe, read, () => '{}');
  const open = force || parse(raw)[id] === true;
  const bodyId = useId();
  return (
    <section className="ps-gd__fold" data-open={open || undefined} data-testid={testId}>
      <button type="button" className="ps-gd__foldbtn" aria-expanded={open} aria-controls={bodyId} disabled={force} onClick={() => setFold(id, !open)}>
        <span className="ps-gd__foldt">{title}</span>
        {hint && !open && <span className="ps-gd__foldh">{hint}</span>}
        <Icon name="chevron-down" size={16} />
      </button>
      <div id={bodyId} className="ps-gd__foldbody" hidden={!open}>{open && children}</div>
    </section>
  );
}
