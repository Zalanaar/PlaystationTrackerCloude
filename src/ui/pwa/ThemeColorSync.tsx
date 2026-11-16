'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { syncThemeMeta } from '../theme-meta';
import { themeFromAttr } from '../theme';

/**
 * Держит <meta name="theme-color"> в соответствии с data-theme на html. Next при клиентской навигации может вернуть
 * theme-color из закешированного RSC (старая тема), поэтому пересинхронизируем после каждой смены пути и темы.
 */
export function ThemeColorSync() {
  const path = usePathname();
  // П11.5.2: приложение ожило — заставка холодного старта PWA (.ps-boot) больше не нужна
  useEffect(() => { document.documentElement.setAttribute('data-hydrated', ''); }, []);
  useEffect(() => {
    const apply = () => { syncThemeMeta(document as never, themeFromAttr(document.documentElement.getAttribute('data-theme'))); };
    apply();
    window.addEventListener('ps-theme-change', apply);
    return () => window.removeEventListener('ps-theme-change', apply);
  }, [path]);
  return null;
}
