'use client';

import { ErrorPanel } from '@/ui/ErrorPanel';

// Ошибка рендера внутри приложения: шапка и нижнее меню остаются.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel reset={reset} digest={error.digest} />;
}
