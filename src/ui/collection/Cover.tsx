'use client';

import { useState } from 'react';
import { coverSrcSet } from '../format';

/** sizes по умолчанию: карточка сетки (2 колонки на мобильном, ~190 px на десктопе). */
export const CARD_SIZES = '(max-width: 640px) 45vw, 240px';
/** sizes миниатюр (строки, «Ближе к платине», окно игры): до ~96 px. */
export const THUMB_SIZES = '96px';

/** Стабильный номер варианта градиента по названию (0..5). */
export function coverVariant(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return h % 6;
}

/** Обложка 3/4. Нет картинки или не загрузилась: градиент из токенов (вариант по названию) + название. */
export function Cover({ url, title, className, priority, sizes = CARD_SIZES }: {
  url: string | null; title: string; className?: string;
  /** атрибут sizes для srcset (Фаза 47): обложки PSN грузятся нужной ширины, а не оригиналом 512–1024 px */
  sizes?: string;
  /** первый ряд экрана (кандидат в LCP): грузить сразу и с высоким приоритетом (Фаза 47) */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const bad = !url || failed === url;
  if (bad) {
    return (
      <div className={`ps-cover ps-cover--empty ${className ?? ''}`} data-v={coverVariant(title)} role="img" aria-label={title}>
        <span>{title}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- внешние обложки PSN, оптимизация next/image не нужна
    <img
      src={url} srcSet={coverSrcSet(url)} sizes={sizes} alt="" decoding="async" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} referrerPolicy="no-referrer"
      className={`ps-cover ps-cover-img ${className ?? ''}`} onError={() => setFailed(url)}
    />
  );
}
