import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WrappedView } from '@/ui/wrapped/WrappedView';
import { WrappedPageSkeleton } from '@/ui/skeletons';

export const metadata: Metadata = { title: 'Итоги · PS Tracker' };

export default function Page() {
  return (
    <Suspense fallback={<WrappedPageSkeleton />}>
      <WrappedView />
    </Suspense>
  );
}
