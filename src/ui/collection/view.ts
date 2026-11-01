'use client';

import { useSyncExternalStore } from 'react';
import { isViewMode } from './filters';
import { VIEW_STORAGE_KEY } from '../tokens';
import { readProfileValue, subscribeProfileScope, writeProfileValue } from '../profiles/scope';

const EVENT = 'ps-view-change';

function read(): string | null {
  return readProfileValue(VIEW_STORAGE_KEY, { legacy: true });
}

/** Сохранённый вид сетки (localStorage['ps-view:{activeProfileId}'], до Фазы 41 общий 'ps-view'); на сервере null. */
export function useStoredView(): string | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb); window.addEventListener('storage', cb);
      const off = subscribeProfileScope(cb);
      return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); off(); };
    },
    read,
    () => null,
  );
}

export function storeView(v: string): void {
  if (!isViewMode(v)) return;
  writeProfileValue(VIEW_STORAGE_KEY, v);
  window.dispatchEvent(new Event(EVENT));
}
