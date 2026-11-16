import type { MetadataRoute } from 'next';
import { SPLASH_THEME_BG, type SplashTheme } from './splash';

/** Ссылка на манифест: Night (по умолчанию) — без параметра, иначе ?theme=. Цвета подставляет маршрут manifest.webmanifest. */
export const manifestHref = (theme: SplashTheme): string => (theme === 'night' ? '/manifest.webmanifest' : `/manifest.webmanifest?theme=${theme}`);

/** Тема из ?theme= (только известные id; иначе Night). */
export const manifestTheme = (raw: string | null): SplashTheme =>
  raw !== null && Object.prototype.hasOwnProperty.call(SPLASH_THEME_BG, raw) ? (raw as SplashTheme) : 'night';

// docs/design-system.md §8.5. П11.5.2: background_color/theme_color — фон выбранной темы (заставка Android и полоса статуса до первой отрисовки).
export function buildManifest(theme: SplashTheme = 'night'): MetadataRoute.Manifest {
  const bg = SPLASH_THEME_BG[theme];
  return {
    name: 'PS Tracker',
    short_name: 'PS Tracker',
    description: 'Личный трекер игр PlayStation',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'ru',
    categories: ['games', 'entertainment'],
    background_color: bg,
    theme_color: bg,
    // Пакет 6, п. 8: долгое нажатие на иконку (Android/десктоп; iOS ярлыки манифеста не показывает)
    shortcuts: [
      { name: 'Бэклог', short_name: 'Бэклог', url: '/backlog', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Статистика', short_name: 'Статистика', url: '/stats', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Добавить игру', short_name: 'Добавить', description: 'Игра с другой платформы', url: '/?add=other', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
