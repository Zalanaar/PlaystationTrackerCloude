'use client';

import { useSyncExternalStore } from 'react';
import { useIsMobile } from '../primitives/hooks';
import { BACKLOG_VIEW_KEY, isBacklogView, resolveBacklogView, type BacklogView } from './backlog';

const EVENT = 'ps-bl-view-change';

let memory: string | null = null; // запасной вариант, если localStorage недоступен

function read(): string | null {
  try { return localStorage.getItem(BACKLOG_VIEW_KEY) ?? memory; } catch { return memory; }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); };
}

function store(v: BacklogView): void {
  if (!isBacklogView(v)) return;
  memory = v;
  try { localStorage.setItem(BACKLOG_VIEW_KEY, v); } catch { /* приватный режим: вид живёт до перезагрузки */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Вид Бэклога (карточки или список): сохранённый выбор, иначе список на мобильном и карточки на десктопе. */
export function useBacklogView(): [BacklogView, (v: BacklogView) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const mobile = useIsMobile();
  return [resolveBacklogView(stored, mobile), store];
}
