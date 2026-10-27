import type { Metadata } from 'next';
import { EmptyState } from '@/ui/EmptyState';

export const metadata: Metadata = { title: 'Итоги · PS Tracker' };

// Заглушка: раздел появится в одной из следующих фаз.
export default function Page() {
  return (
    <>
      <h1 className="ps-h1">Итоги</h1>
      <EmptyState icon="sparkles" title="Скоро здесь" text="Раздел «Итоги года» в разработке." />
    </>
  );
}
