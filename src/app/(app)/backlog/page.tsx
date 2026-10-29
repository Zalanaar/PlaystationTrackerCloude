import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BacklogView } from '@/ui/collection/BacklogView';
import { BacklogSubnav } from '@/ui/shell/Subnav';
import { BacklogPageSkeleton } from '@/ui/skeletons';

export const metadata: Metadata = { title: 'Бэклог · PS Tracker' };

export default function Page() {
  return (
    <>
      <BacklogSubnav />
      <Suspense fallback={<BacklogPageSkeleton subnav={false} />}>
        <BacklogView />
      </Suspense>
    </>
  );
}
