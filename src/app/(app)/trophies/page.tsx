import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { loadNearInitial, loadTrophyFeedInitial } from '@/server/trophies/initial';
import { TrophyFeedView } from '@/ui/trophies/TrophyFeedView';
import { parsePeriod, parseRare, parseView } from '@/ui/trophies/model';

export const metadata: Metadata = { title: 'Трофеи · PS Tracker' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// F3 «Лента трофеев»: первая страница в HTML (SSR, без скелета и сдвига), дальше «Показать ещё» и фильтры на клиенте.
export default async function Page({ searchParams }: Props) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const rare = parseRare(sp.rare);
  const view = parseView(sp.view);
  const h = await headers();
  // Пакет 6, п. 9: ?view=near — «Почти платина» в HTML, лента загрузится при переключении
  if (view === 'near') {
    const near = await loadNearInitial(h.get('cookie'));
    return <TrophyFeedView initial={null} period={period} rare={rare} view="near" nearInitial={near} />;
  }
  const initial = await loadTrophyFeedInitial(h.get('cookie'), period, rare);
  return <TrophyFeedView initial={initial} period={period} rare={rare} />;
}
