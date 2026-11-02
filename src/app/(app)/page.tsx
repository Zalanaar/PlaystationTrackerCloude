import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { CollectionView } from '@/ui/collection/CollectionView';
import { HERO_HINT_COOKIE, parseHeroHint } from '@/ui/collection/heroHint';
import { CollectionPageSkeleton } from '@/ui/skeletons';

export default async function CollectionPage() {
  // Подсказка «есть ли игры „Играю“» с прошлого визита: без неё скелет hero исчезал и сдвигал страницу
  const heroHint = parseHeroHint((await cookies()).get(HERO_HINT_COOKIE)?.value);
  return (
    <Suspense fallback={<CollectionPageSkeleton hero={heroHint !== false} />}>
      <CollectionView heroHint={heroHint} />
    </Suspense>
  );
}
