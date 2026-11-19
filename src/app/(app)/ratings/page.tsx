import type { Metadata } from 'next';
import { RatingsView } from '@/ui/ratings/RatingsView';

export const metadata: Metadata = { title: 'Мои оценки · PS Tracker' };

export default function Page() {
  return <RatingsView />;
}
