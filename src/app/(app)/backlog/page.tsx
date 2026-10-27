import type { Metadata } from 'next';
import { EmptyState } from '@/ui/EmptyState';

export const metadata: Metadata = { title: 'Бэклог · PS Tracker' };

// Заглушка: раздел появится в одной из следующих фаз.
export default function Page() {
  return (
    <>
      <h1 className="ps-h1">Бэклог</h1>
      <EmptyState icon="bookmark" title="Скоро здесь" text="Раздел «Бэклог» в разработке. Пока статус «Бэклог» можно ставить в коллекции." />
    </>
  );
}
