import type { Metadata } from 'next';
import { BacklogView } from '@/ui/collection/BacklogView';

export const metadata: Metadata = { title: 'Бэклог · PS Tracker' };

export default function Page() {
  return <BacklogView />;
}
