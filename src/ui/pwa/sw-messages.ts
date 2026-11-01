// Общие с public/sw.js константы клиента: URL воркера и типы сообщений.
export const SW_URL = '/sw.js';

/** Чистим кэши воркера: вызывается при выходе из аккаунта (в кэше и так только статика, это страховка) */
export async function purgeServiceWorkerCaches(): Promise<void> {
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
