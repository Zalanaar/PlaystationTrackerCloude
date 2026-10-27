import type { Metadata, Viewport } from 'next';
import { Inter, Manrope, Pixelify_Sans } from 'next/font/google';
import '@/ui/tokens/tokens.css';
import '@/ui/tokens/themes.css';
import '@/ui/tokens/decor.css';
import './globals.css';
import { themeInitScript } from '@/ui/theme-script';

const inter = Inter({ subsets: ['latin', 'cyrillic'], display: 'swap', variable: '--f-inter' });
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], display: 'swap', variable: '--f-manrope' });
// Pixelify Sans: подключаем latin и cyrillic, фолбэк из токенов остаётся запасным
const pixel = Pixelify_Sans({ subsets: ['latin', 'cyrillic'], display: 'swap', variable: '--f-pixel' });

export const metadata: Metadata = {
  title: 'PS Tracker',
  description: 'Личный трекер игр PlayStation',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${inter.variable} ${manrope.variable} ${pixel.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="ps-app min-h-screen">{children}</div>
      </body>
    </html>
  );
}
