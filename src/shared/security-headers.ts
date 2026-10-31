// Заголовки безопасности (docs/api-contract.md, раздел «Заголовки безопасности»). Чистый модуль: без env/БД/сети,
// его импортирует next.config.ts. Менять вместе с контрактом.

export interface HeaderPair { key: string; value: string }

/**
 * CSP страниц и API: с `nonce` (его генерирует proxy.ts на каждый запрос, layout.tsx ставит на inline-скрипт темы, Next на свой бутстрап)
 * script-src = 'self' 'nonce-...' без 'unsafe-inline'. Без nonce (вызов без аргумента) остаётся прежний вариант с 'unsafe-inline'.
 * Остальное закрыто: object/base/form/frame-ancestors, шрифты и connect только со своего origin.
 * img-src https: потому что обложки приходят с CDN PSN/RAWG/HLTB и из пользовательской ссылки (https://, roadmap coverUrl).
 * В dev добавлен 'unsafe-eval' (React Fast Refresh).
 */
export function buildCsp(opts: { dev?: boolean; nonce?: string } = {}): string {
  const script = ["'self'", opts.nonce ? `'nonce-${opts.nonce}'` : "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])].join(' ');
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** CSP для статических файлов вне proxy (manifest, иконки): ничего не грузят и не исполняют. */
export const STATIC_ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

/** Заголовки без CSP: next.config отдаёт их на все пути. CSP страниц и API ставит proxy.ts (с nonce). */
export function baseSecurityHeaders(): HeaderPair[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  ];
}

/** Полный набор с CSP без nonce (обратная совместимость и тесты). */
export function securityHeaders(opts: { dev?: boolean } = {}): HeaderPair[] {
  return [{ key: 'Content-Security-Policy', value: buildCsp(opts) }, ...baseSecurityHeaders()];
}
