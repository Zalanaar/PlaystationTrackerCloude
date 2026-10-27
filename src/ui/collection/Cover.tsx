'use client';

import { useState } from 'react';

/** Стабильный номер варианта градиента по названию (0..5). */
export function coverVariant(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return h % 6;
}

/** Обложка 3/4. Нет картинки или не загрузилась: градиент из токенов (вариант по названию) + название. */
export function Cover({ url, title, className }: { url: string | null; title: string; className?: string }) {
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
      src={url} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer"
      className={`ps-cover ps-cover-img ${className ?? ''}`} onError={() => setFailed(url)}
    />
  );
}
