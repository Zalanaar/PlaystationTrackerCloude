import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StatsView } from '@/ui/stats/StatsView';

export const metadata: Metadata = { title: 'Статистика · PS Tracker' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StatsView />
    </Suspense>
  );
}
