import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecommendView } from '@/ui/recommend/RecommendView';

export const metadata: Metadata = { title: 'Подскажи · PS Tracker' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RecommendView />
    </Suspense>
  );
}
