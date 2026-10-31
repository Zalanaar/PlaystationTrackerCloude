import type { NextConfig } from 'next';
import { STATIC_ASSET_CSP, baseSecurityHeaders } from './src/shared/security-headers';

const nextConfig: NextConfig = {
  async headers() {
    // Заголовки без CSP: на все пути, включая /api, manifest и иконки. CSP страниц и API (с nonce) ставит src/proxy.ts.
    // Файлы, которые proxy не обслуживает (matcher), получают строгий CSP без скриптов здесь.
    return [
      { source: '/:path*', headers: baseSecurityHeaders() },
      {
        source: '/:file(manifest\\.webmanifest|icon\\.svg|favicon\\.ico|apple-icon\\.png)',
        headers: [{ key: 'Content-Security-Policy', value: STATIC_ASSET_CSP }],
      },
      { source: '/icons/:path*', headers: [{ key: 'Content-Security-Policy', value: STATIC_ASSET_CSP }] },
    ];
  },
};

export default nextConfig;
