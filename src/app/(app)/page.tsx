import { Suspense } from 'react';
import { cookies, headers } from 'next/headers';
import { CollectionView } from '@/ui/collection/CollectionView';
import { HERO_HINT_COOKIE, parseHeroHint } from '@/shared/hero-hint';
import { LAYOUT_HINT_COOKIE, parseLayoutHint, type LayoutHint } from '@/shared/layout-hint';
import { CollectionPageSkeleton } from '@/ui/skeletons';
import { loadCollectionInitial } from '@/server/collection/initial';
import { gamesBatchUrl } from '@/ui/collection/batchUrl';
import { buildPlan } from '@/ui/collection/blocks';
import { DEFAULT_FILTERS } from '@/ui/collection/filters';

/** URL пакета блоков для `/` без параметров: ровно тот, что посчитает клиент (useCollectionData → buildPlan). */
const DEFAULT_BATCH_URL = gamesBatchUrl(buildPlan(DEFAULT_FILTERS.status, DEFAULT_FILTERS.q, DEFAULT_FILTERS.platinum).map((p) => p.query));

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CollectionPage({ searchParams }: Props) {
  const jar = await cookies();
  // Подсказка «есть ли игры „Играю“» с прошлого визита: без неё скелет hero исчезал и сдвигал страницу
  const heroHint = parseHeroHint(jar.get(HERO_HINT_COOKIE)?.value);
  const layout = parseLayoutHint(jar.get(LAYOUT_HINT_COOKIE)?.value);
  // item 4 (LCP): первый экран с играми прямо в HTML. Только загрузка документа `/` без параметров (Sec-Fetch-Mode: navigate;
  // заголовок RSC Next странице не передаёт). Клиентские переходы, закрытие окна игры и смена фильтров идут прежним путём через кэш GET,
  // без ожидания БД на сервере. Браузер без Sec-Fetch-* (Safari < 16.4) получает данные всегда: только медленнее переход.
  const h = await headers();
  const sp = await searchParams;
  const mode = h.get('sec-fetch-mode');
  const ssr = Object.keys(sp).length === 0 && (mode === null || mode === 'navigate');
  const cookieHeader = ssr ? h.get('cookie') : null;
  return (
    <Suspense fallback={<CollectionPageSkeleton hero={heroHint !== false} />}>
      <CollectionWithData heroHint={heroHint} layout={layout} cookieHeader={cookieHeader} />
    </Suspense>
  );
}

/** Внутри Suspense: скелет страницы уходит в первом куске HTML, коллекция дописывается тем же ответом, как только готова БД. */
async function CollectionWithData({ heroHint, layout, cookieHeader }: { heroHint: boolean | undefined; layout: LayoutHint; cookieHeader: string | null }) {
  const initial = cookieHeader ? await loadCollectionInitial(cookieHeader, DEFAULT_BATCH_URL) : null;
  return <CollectionView heroHint={heroHint} initial={initial} layout={layout} />;
}
