import { Suspense } from 'react';
import { CollectionView } from '@/ui/collection/CollectionView';

export default function CollectionPage() {
  return (
    <Suspense fallback={null}>
      <CollectionView />
    </Suspense>
  );
}
