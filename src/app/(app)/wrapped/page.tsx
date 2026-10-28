import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WrappedView } from '@/ui/wrapped/WrappedView';

export const metadata: Metadata = { title: 'Итоги · PS Tracker' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WrappedView />
    </Suspense>
  );
}
