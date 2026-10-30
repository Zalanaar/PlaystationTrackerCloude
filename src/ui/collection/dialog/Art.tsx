'use client';

import { useState } from 'react';
import type { ArtMode } from '../details';

/**
 * Арт шапки (спека 9.1 п.2.2): баннер; нет баннера или он не загрузился, есть обложка: размытая компактная лента; нет ничего: заливка темы.
 * Скрим и высота зависят от `data-art` родителя `.ps-gd__hero`.
 */
export function Art({ mode, bannerUrl, coverUrl, loading, onBannerError }: {
  mode: ArtMode; bannerUrl: string | null; coverUrl: string | null; loading: boolean; onBannerError: () => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const src = mode === 'banner' ? bannerUrl : mode === 'blur' ? coverUrl : null;
  // уже закэшированная картинка может не прислать onLoad после гидратации
  const imgRef = (el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth > 0 && shown !== src) setShown(src); };
  return (
    <div className="ps-gd__art" aria-hidden="true" data-loading={loading || undefined}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- внешний арт и обложки PSN
        <img
          ref={imgRef} src={src} alt="" decoding="async" referrerPolicy="no-referrer" data-shown={shown === src || undefined}
          onLoad={() => setShown(src)} onError={() => { if (mode === 'banner') onBannerError(); }}
        />
      )}
    </div>
  );
}
