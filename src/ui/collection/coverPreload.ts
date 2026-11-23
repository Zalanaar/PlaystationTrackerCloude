'use client';

// Предзагрузка обложек очереди «Разбора»: тот же URL, что ставит Cover (`psnImageUrl` + ширина на экране).
// Новый <img> после смены игры рисуется из кэша, а не с пустым кадром на 1–1.5 с.
import { useEffect } from 'react';
import { psnImageUrl } from '../format';

/** Сколько следующих обложек декодировать заранее. */
export const COVER_PRELOAD_AHEAD = 5;

/** Уникальные src обложек — в том виде, в каком их запрашивает <Cover>. */
export function coverPreloadSrcs(urls: ReadonlyArray<string | null | undefined>, w: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    const src = psnImageUrl(u, w);
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

/** Image() + <link rel="preload">, чтобы браузер (в т.ч. iOS Safari) декодировал кадр до смены карточки. */
export function preloadCovers(urls: ReadonlyArray<string | null | undefined>, w: number): string[] {
  const srcs = coverPreloadSrcs(urls, w);
  for (const src of srcs) {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = src;
    const dec = img.decode;
    if (typeof dec === 'function') void dec.call(img).catch(() => { /* достаточно кэша байт */ });
  }
  return srcs;
}

export function useCoverPreload(urls: ReadonlyArray<string | null | undefined>, w: number) {
  const srcs = coverPreloadSrcs(urls, w);
  const sig = srcs.join(' ');
  useEffect(() => {
    if (!srcs.length) return;
    preloadCovers(srcs, w);
    const links = srcs.map((href) => {
      const el = document.createElement('link');
      el.rel = 'preload';
      el.as = 'image';
      el.href = href;
      el.setAttribute('data-cover-preload', '');
      document.head.appendChild(el);
      return el;
    });
    return () => { for (const el of links) el.remove(); };
    // srcs синхронизированы с sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, w]);
}

/** Вешается в дереве «Разбора», чтобы хук не попадал за early-return родителя. */
export function CoverPreload({ urls, w }: { urls: ReadonlyArray<string | null | undefined>; w: number }) {
  useCoverPreload(urls, w);
  return null;
}

