import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { BacklogView } from '@/ui/collection/BacklogView';
import { BacklogSubnav } from '@/ui/shell/Subnav';
import { BacklogPageSkeleton } from '@/ui/skeletons';
import { PLATFORM_COOKIE, parsePlatform } from '@/shared/platform-filter';

export const metadata: Metadata = { title: 'Бэклог · PS Tracker' };

export default async function Page() {
  // F4: запомненная платформа (общая с Коллекцией), чтобы первый запрос сразу шёл с ней
  const platform = parsePlatform((await cookies()).get(PLATFORM_COOKIE)?.value);
  return (
    <>
      <BacklogSubnav />
      <Suspense fallback={<BacklogPageSkeleton subnav={false} />}>
        <BacklogView platformDefault={platform} />
      </Suspense>
    </>
  );
}
