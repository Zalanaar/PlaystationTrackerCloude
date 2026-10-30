'use client';

import { useEffect } from 'react';
import { cssUrl, smallCoverUrl } from '../../format';

/** PS5: арт страницы (--page-art) = обложка первой игры из ленты «Играю»; на мобильном маленькая версия. */
export function usePageArt(coverUrl: string | null | undefined, isMobile: boolean) {
  const art = cssUrl(isMobile ? smallCoverUrl(coverUrl) : coverUrl);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.ps-app');
    if (!root) return;
    if (art) root.style.setProperty('--page-art', art);
    else root.style.removeProperty('--page-art');
    return () => { root.style.removeProperty('--page-art'); };
  }, [art]);
}
