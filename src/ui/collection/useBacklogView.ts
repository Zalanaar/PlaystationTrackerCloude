'use client';

import { useSyncExternalStore } from 'react';
import { useIsMobile } from '../primitives/hooks';
import { readProfileValue, registerCacheReset, subscribeProfileScope, writeProfileValue } from '../profiles/scope';
import { BACKLOG_VIEW_KEY, isBacklogView, resolveBacklogView, type BacklogView } from './backlog';

const EVENT = 'ps-bl-view-change';

let memory: string | null = null; // запасной вариант, если localStorage недоступен (сбрасывается при смене профиля)
registerCacheReset(() => { memory = null; });

function read(): string | null {
  return readProfileValue(BACKLOG_VIEW_KEY, { legacy: true }) ?? memory;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  const off = subscribeProfileScope(cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); off(); };
}

function store(v: BacklogView): void {
  if (!isBacklogView(v)) return;
  memory = v;
  writeProfileValue(BACKLOG_VIEW_KEY, v); // без хранилища вид живёт в memory до перезагрузки
  window.dispatchEvent(new Event(EVENT));
}

/** Вид Бэклога (карточки или список): сохранённый выбор, иначе список на мобильном и карточки на десктопе. */
export function useBacklogView(): [BacklogView, (v: BacklogView) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const mobile = useIsMobile();
  return [resolveBacklogView(stored, mobile), store];
}
