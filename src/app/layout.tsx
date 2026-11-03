import type { Metadata, Viewport } from 'next';
import { Inter, Unbounded } from 'next/font/google';
import '@/ui/tokens/tokens.css';
import '@/ui/tokens/themes.css';
import '@/ui/tokens/decor.css';
import '@/ui/styles/base.css';
import './globals.css';
// Стили закрытой части (включая скелеты и доступ) — в @/ui/styles/app-styles (подключают (app)/layout, onboarding, offline, error, 404): /login их не грузит (Фаза 47)
import { cookies, headers } from 'next/headers';
import { ServiceWorkerRegister } from '@/ui/pwa/ServiceWorkerRegister';
import { ThemeColorSync } from '@/ui/pwa/ThemeColorSync';
import { APPLE_STATUS_BAR_STYLE } from '@/ui/theme-meta';
import { themeInitScript } from '@/ui/theme-script';
import { attrForTheme, normalizeTheme, xmbMonth } from '@/ui/theme';
import { THEME_COLORS, THEME_STORAGE_KEY } from '@/ui/tokens';

const inter = Inter({ subsets: ['latin', 'cyrillic'], display: 'swap', variable: '--f-inter' });
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], display: 'swap', variable: '--f-unbounded' });

export const metadata: Metadata = {
  title: 'PS Tracker',
  description: 'Личный трекер игр PlayStation',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'PS Tracker', statusBarStyle: APPLE_STATUS_BAR_STYLE },
};

/** viewport-fit=cover (иначе env(safe-area-inset-*) на iPhone равен 0) и theme-color = --bg темы из cookie (§8.5). */
export async function generateViewport(): Promise<Viewport> {
  const theme = normalizeTheme((await cookies()).get(THEME_STORAGE_KEY)?.value);
  return { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: THEME_COLORS[theme] };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Тема из cookie уже в серверной разметке (без мигания); inline-скрипт добирает localStorage и чинит alias.
  const theme = normalizeTheme((await cookies()).get(THEME_STORAGE_KEY)?.value);
  // nonce CSP из proxy.ts (контракт 21): без него (прямой рендер, тесты) скрипт темы идёт без nonce
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="ru" suppressHydrationWarning data-theme={attrForTheme(theme) ?? undefined} data-xmb-month={xmbMonth()} className={`${inter.variable} ${unbounded.variable}`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* CDN обложек PSN: DNS+TLS, пока сервер ждёт БД, — первая обложка (LCP `/`) не ждёт соединения. Картинки без CORS: без crossorigin */}
        <link rel="preconnect" href="https://image.api.playstation.com" />
      </head>
      <body>
        <div className="ps-app min-h-screen">{children}</div>
        <ServiceWorkerRegister />
        <ThemeColorSync />
      </body>
    </html>
  );
}
