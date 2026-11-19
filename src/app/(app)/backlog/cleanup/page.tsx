import type { Metadata } from 'next';
import { CleanupView } from '@/ui/cleanup/CleanupView';

export const metadata: Metadata = { title: 'Чистка бэклога · PS Tracker' };

export default function Page() {
  return <CleanupView />;
}
