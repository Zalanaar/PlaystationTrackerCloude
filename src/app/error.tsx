'use client';

import '@/ui/styles/app-styles';
import { ErrorPanel } from '@/ui/ErrorPanel';

// Ошибка вне шелла приложения (например /login).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="ps-container">
      <ErrorPanel reset={reset} digest={error.digest} />
    </main>
  );
}
