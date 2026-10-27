import type { Metadata } from 'next';
import { EmptyState } from '@/ui/EmptyState';

export const metadata: Metadata = { title: 'Статистика · PS Tracker' };

// Заглушка: раздел появится в одной из следующих фаз.
export default function Page() {
  return (
    <>
      <h1 className="ps-h1">Статистика</h1>
      <EmptyState icon="bar-chart" title="Скоро здесь" text="Раздел «Статистика» в разработке." />
    </>
  );
}
