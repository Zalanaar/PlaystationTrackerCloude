import type { NextConfig } from 'next';
import { STATIC_ASSET_CSP, baseSecurityHeaders } from './src/shared/security-headers';

const nextConfig: NextConfig = {
  // Не светить фреймворк в X-Powered-By (повторный аудит P2-7).
  poweredByHeader: false,
  // Только `next dev`: значок/подсказки dev-оверлея в левом нижнем углу перекрывали всплывающие меню в e2e (клик уходил в nextjs-portal)
  devIndicators: false,
  // П16.2: разделы таббара (динамические из-за сессии) предзагружаются целиком в простое; 30 с переход берёт их из кэша роутера
  // без запроса к серверу — смена вкладки не ждёт сеть. Данные экранов всё равно приходят из API (кэш GET 30 с, сбросы при записи).
  experimental: { staleTimes: { dynamic: 30 } },
  // П8.3: шрифты картинки «Поделиться» читаются с диска в маршруте — включить их в сборку функции
  outputFileTracingIncludes: { '/api/wrapped/share': ['./src/server/wrapped/share-fonts/*.woff'] },
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
