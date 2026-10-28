import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BacklogView } from '@/ui/collection/BacklogView';

export const metadata: Metadata = { title: 'Бэклог · PS Tracker' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BacklogView />
    </Suspense>
  );
}
