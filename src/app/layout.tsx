import type { Metadata, Viewport } from 'next';
import { Inter, Unbounded } from 'next/font/google';
import '@/ui/tokens/tokens.css';
import '@/ui/tokens/themes.css';
import '@/ui/tokens/decor.css';
import '@/ui/components.css';
import '@/ui/game91.css';
import './globals.css';
import { cookies } from 'next/headers';
import { themeInitScript } from '@/ui/theme-script';
import { attrForTheme, normalizeTheme, xmbMonth } from '@/ui/theme';
import { THEME_STORAGE_KEY } from '@/ui/tokens';

const inter = Inter({ subsets: ['latin', 'cyrillic'], display: 'swap', variable: '--f-inter' });
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], display: 'swap', variable: '--f-unbounded' });

export const metadata: Metadata = {
  title: 'PS Tracker',
  description: 'Личный трекер игр PlayStation',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Тема из cookie уже в серверной разметке (без мигания); inline-скрипт добирает localStorage и чинит alias.
  const theme = normalizeTheme((await cookies()).get(THEME_STORAGE_KEY)?.value);
  return (
    <html lang="ru" suppressHydrationWarning data-theme={attrForTheme(theme) ?? undefined} data-xmb-month={xmbMonth()} className={`${inter.variable} ${unbounded.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="ps-app min-h-screen">{children}</div>
      </body>
    </html>
  );
}
