import type { Metadata } from 'next';
import { BacklogSubnav } from '@/ui/shell/Subnav';
import { RoadmapView } from '@/ui/roadmap/RoadmapView';

export const metadata: Metadata = { title: 'План · PS Tracker' };

export default function Page() {
  return (
    <>
      <BacklogSubnav />
      <RoadmapView />
    </>
  );
}
