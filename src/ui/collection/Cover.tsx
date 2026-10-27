'use client';

import { useState } from 'react';

/** Обложка 3/4; нет картинки или не загрузилась: плашка --surface-3 с названием. */
export function Cover({ url, title, className }: { url: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const bad = !url || failed === url;
  if (bad) {
    return (
      <div className={`ps-cover ps-cover--empty ${className ?? ''}`} role="img" aria-label={title}>
        <span>{title}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- внешние обложки PSN, оптимизация next/image не нужна
    <img
      src={url} alt="" decoding="async" referrerPolicy="no-referrer"
      className={`ps-cover ps-cover-img ${className ?? ''}`} onError={() => setFailed(url)}
    />
  );
}
