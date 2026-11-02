'use client';

import { useState } from 'react';
import { PSN_W, psnImageUrl } from '../format';

/** Ширина миниатюр (строки, «Ближе к платине», окно игры, статистика): до ~96 px на экране. */
export const THUMB_W = PSN_W.thumb;
/** Крупные обложки (разбор, итоги года). */
export const LARGE_W = PSN_W.large;

/** Стабильный номер варианта градиента по названию (0..5). */
export function coverVariant(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return h % 6;
}

/** Обложка 3/4. Нет картинки или не загрузилась: градиент из токенов (вариант по названию) + название. */
export function Cover({ url, title, className, priority, w = PSN_W.card }: {
  url: string | null; title: string; className?: string;
  /** ширина на экране в CSS px (Фаза 47): Image API PSN отдаёт копию под неё и DPR, а не оригинал 512–1024 px */
  w?: number;
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
      src={psnImageUrl(url, w)} alt="" decoding="async" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} referrerPolicy="no-referrer"
      className={`ps-cover ps-cover-img ${className ?? ''}`} onError={() => setFailed(url)}
    />
  );
}
