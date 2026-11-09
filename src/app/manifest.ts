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
