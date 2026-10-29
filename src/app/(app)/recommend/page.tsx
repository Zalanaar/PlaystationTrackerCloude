import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecommendView } from '@/ui/recommend/RecommendView';
import { BacklogSubnav } from '@/ui/shell/Subnav';
import { RecommendPageSkeleton } from '@/ui/skeletons';

export const metadata: Metadata = { title: 'Подскажи · PS Tracker' };

export default function Page() {
  return (
    <>
      <BacklogSubnav />
      <Suspense fallback={<RecommendPageSkeleton subnav={false} />}>
        <RecommendView />
      </Suspense>
    </>
  );
}
