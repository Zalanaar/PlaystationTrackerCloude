import { Suspense } from 'react';
import { CollectionView } from '@/ui/collection/CollectionView';
import { CollectionPageSkeleton } from '@/ui/skeletons';

export default function CollectionPage() {
  return (
    <Suspense fallback={<CollectionPageSkeleton />}>
      <CollectionView />
    </Suspense>
  );
}
