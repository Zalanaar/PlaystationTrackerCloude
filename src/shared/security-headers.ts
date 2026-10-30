// Заголовки безопасности (docs/api-contract.md, раздел «Заголовки безопасности»). Чистый модуль: без env/БД/сети,
// его импортирует next.config.ts. Менять вместе с контрактом.

export interface HeaderPair { key: string; value: string }

/**
 * CSP без nonce. 'unsafe-inline' в script-src нужен: inline-скрипт темы в layout и inline-бутстрап Next.
 * Остальное закрыто: object/base/form/frame-ancestors, шрифты и connect только со своего origin.
 * img-src https: потому что обложки приходят с CDN PSN/RAWG/HLTB и из пользовательской ссылки (https://, roadmap coverUrl).
 * В dev добавлен 'unsafe-eval' (React Fast Refresh).
 */
export function buildCsp(opts: { dev?: boolean } = {}): string {
  const script = ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])].join(' ');
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

export function securityHeaders(opts: { dev?: boolean } = {}): HeaderPair[] {
  return [
    { key: 'Content-Security-Policy', value: buildCsp(opts) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  ];
}
