// Общие с public/sw.js константы клиента: URL воркера и типы сообщений.
import { clearOfflineSnapshot } from './offline-data';

export const SW_URL = '/sw.js';

/** Чистим кэши воркера: вызывается при выходе из аккаунта. Стирает и копию для офлайн-просмотра (кэш «ps-data», пакет 7, п. 2). */
export async function purgeServiceWorkerCaches(): Promise<void> {
  await clearOfflineSnapshot();
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: 'PURGE' });
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('ps-')).map((k) => caches.delete(k)));
    }
  } catch { /* кэша нет или запрещён: не мешаем выходу */ }
}
