// Адрес картинки только по https (CSP `upgrade-insecure-requests` и mixed content): http://host/... -> https://host/...
// Чистая функция, без env и сети. Другие схемы и мусор не трогаем (возвращаем как есть).

export function toHttps(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;
  const s = url.trim();
  if (s === '') return null;
  return /^http:\/\//i.test(s) ? `https://${s.slice(7)}` : s;
}
