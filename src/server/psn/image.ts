// Загрузка картинки с CDN PSN (обложки) для расчёта цвета акцента (контракт 15.2). Только https, лимиты размера и времени.
import { httpsUrl } from './mapping';

export const IMAGE_TIMEOUT_MS = 8000;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

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
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), redirect: 'follow', cache: 'no-store' });
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
