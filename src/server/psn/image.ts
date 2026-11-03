// Загрузка картинки с CDN PSN (обложки) для расчёта цвета акцента (контракт 15.2). Только https, лимиты размера и времени.
import { httpsUrl } from './mapping';

export const IMAGE_TIMEOUT_MS = 8000;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_MAX_REDIRECTS = 3;

/** Публичный https-хост: не localhost и не IP-литерал (защита от SSRF по значению из БД). */
export function isPublicHttpsImageUrl(v: unknown): v is string {
  const u = httpsUrl(v);
  if (!u) return false;
  const host = new URL(u).hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

export async function fetchImageBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (!isPublicHttpsImageUrl(url)) throw new Error('image: недопустимый URL');
  // Редиректы вручную: каждый Location проходит ту же проверку, что и исходный URL (SSRF через redirect, повторный аудит P2-8).
  const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
  let current = url;
  let res = await fetchImpl(current, { signal, redirect: 'manual', cache: 'no-store' });
  for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
    const location = res.headers.get('location');
    await res.body?.cancel();
    if (!location || hop >= IMAGE_MAX_REDIRECTS) throw new Error('image: слишком много редиректов');
    const next = new URL(location, current).toString();
    if (!isPublicHttpsImageUrl(next)) throw new Error('image: недопустимый редирект');
    current = next;
    res = await fetchImpl(current, { signal, redirect: 'manual', cache: 'no-store' });
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`image: HTTP ${res.status}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('image/')) {
    await res.body?.cancel();
    throw new Error('image: не изображение');
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    await res.body?.cancel();
    throw new Error('image: слишком большой файл');
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > IMAGE_MAX_BYTES) throw new Error('image: слишком большой файл');
  return buf;
}
