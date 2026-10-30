import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StatsView } from '@/ui/stats/StatsView';
import { StatsPageSkeleton } from '@/ui/skeletons';

export const metadata: Metadata = { title: 'Статистика · PS Tracker' };

export default function Page() {
  return (
    <Suspense fallback={<StatsPageSkeleton />}>
      <StatsView />
    </Suspense>
  );
}
