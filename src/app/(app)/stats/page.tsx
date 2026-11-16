import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { StatsView } from '@/ui/stats/StatsView';
import { StatsPageSkeleton } from '@/ui/skeletons';
import { WRAPPED_HIDDEN_COOKIE, ssrWrappedSeason } from '@/shared/wrapped-season';

export const metadata: Metadata = { title: 'Статистика · PS Tracker' };

export default async function Page() {
  // П8.4: баннер «Итоги года готовы» сразу в HTML (МСК, cookie «закрыт»): без сдвига страницы после загрузки
  const wrappedSsr = ssrWrappedSeason((await cookies()).get(WRAPPED_HIDDEN_COOKIE)?.value);
  return (
    <Suspense fallback={<StatsPageSkeleton />}>
      <StatsView wrappedSsr={wrappedSsr} />
    </Suspense>
  );
}
