'use client';

import { useState } from 'react';
import { avatarInitial } from '../profile/model';

export type AvatarSize = 32 | 36 | 40 | 56 | 96;

/**
 * Аватар PSN (design-system §4.16): `<img>` с fallback на инициал ника.
 * Fallback срабатывает при `url = null` и при ошибке загрузки. Картинка декоративна (`alt=""`): рядом всегда ник.
 * Размер берётся из CSS (`ps-av--32/40/56/96`), чтобы адаптив (48 на мобильном) не требовал JS.
 */
export function Avatar({ url, name, size, className }: { url: string | null | undefined; name: string | null | undefined; size: AvatarSize; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const bad = !url || failed === url;
  return (
    <span className={`ps-av ps-av--${size} ${className ?? ''}`} data-fallback={bad || undefined}>
      {bad ? (
        <span className="ps-av__ini" aria-hidden="true">{avatarInitial(name)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- внешний CDN PSN, оптимизация next/image не нужна
        <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="ps-av__img" onError={() => setFailed(url)} />
      )}
    </span>
  );
}
