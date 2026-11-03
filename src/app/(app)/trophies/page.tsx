import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { loadTrophyFeedInitial } from '@/server/trophies/initial';
import { TrophyFeedView } from '@/ui/trophies/TrophyFeedView';
import { parsePeriod, parseRare } from '@/ui/trophies/model';

export const metadata: Metadata = { title: 'Трофеи · PS Tracker' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// F3 «Лента трофеев»: первая страница в HTML (SSR, без скелета и сдвига), дальше «Показать ещё» и фильтры на клиенте.
export default async function Page({ searchParams }: Props) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const rare = parseRare(sp.rare);
  const h = await headers();
  const initial = await loadTrophyFeedInitial(h.get('cookie'), period, rare);
  return <TrophyFeedView initial={initial} period={period} rare={rare} />;
}
