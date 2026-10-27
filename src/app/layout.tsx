import type { Metadata, Viewport } from 'next';
import { Inter, Unbounded } from 'next/font/google';
import '@/ui/tokens/tokens.css';
import '@/ui/tokens/themes.css';
import '@/ui/tokens/decor.css';
import '@/ui/components.css';
import './globals.css';
import { themeInitScript } from '@/ui/theme-script';

const inter = Inter({ subsets: ['latin', 'cyrillic'], display: 'swap', variable: '--f-inter' });
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], display: 'swap', variable: '--f-unbounded' });

export const metadata: Metadata = {
  title: 'PS Tracker',
  description: 'Личный трекер игр PlayStation',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${inter.variable} ${unbounded.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="ps-app min-h-screen">{children}</div>
      </body>
    </html>
  );
}
