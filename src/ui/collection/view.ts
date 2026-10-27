'use client';

import { useSyncExternalStore } from 'react';
import { isViewMode } from './filters';
import { VIEW_STORAGE_KEY } from '../tokens';

const EVENT = 'ps-view-change';

function read(): string | null {
  try { return localStorage.getItem(VIEW_STORAGE_KEY); } catch { return null; }
}

/** Сохранённый вид сетки (localStorage['ps-view']); на сервере null. */
export function useStoredView(): string | null {
  return useSyncExternalStore(
    (cb) => { window.addEventListener(EVENT, cb); window.addEventListener('storage', cb); return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); }; },
    read,
    () => null,
  );
}

export function storeView(v: string): void {
  if (!isViewMode(v)) return;
  try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* приватный режим */ }
  window.dispatchEvent(new Event(EVENT));
}
