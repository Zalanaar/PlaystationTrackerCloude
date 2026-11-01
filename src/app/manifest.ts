import type { MetadataRoute } from 'next';

// Manifest статичен: цвета Night (тема по умолчанию), docs/design-system.md §8.5.
export default function manifest(): MetadataRoute.Manifest {
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
    background_color: '#0e0f16',
    theme_color: '#0e0f16',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
