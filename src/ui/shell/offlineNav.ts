'use client';
// F22 (аудит UX): без сети касание раздела раньше либо молчало, либо уводило на страницу ошибки браузера (Next при отказе
// RSC-запроса делает полную навигацию). Теперь переход не начинается: тост «Раздел недоступен без сети», а если страницей
// управляет service worker — кнопка «Офлайн-копия» (/offline из кэша SW, снимок коллекции).
import { useCallback } from 'react';
import { useToast } from '../primitives/Toast';

export const OFFLINE_NAV_TEXT = 'Раздел недоступен без сети. Откроется, когда связь вернётся.';

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** true — без сети: переход отменён и показан тост (вызывающий делает preventDefault). */
export function useOfflineNav(): () => boolean {
  const toast = useToast();
  return useCallback(() => {
    if (!isOffline()) return false;
    const sw = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
    toast({
      kind: 'info', text: OFFLINE_NAV_TEXT,
      // полная навигация намеренно: /offline отдаёт SW из кэша, клиентский роутер без сети не дойдёт
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      action: sw ? { label: 'Офлайн-копия', run: () => { window.location.assign('/offline'); } } : undefined,
    });
    return true;
  }, [toast]);
}
