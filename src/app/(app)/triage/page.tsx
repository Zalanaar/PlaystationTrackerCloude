import type { Metadata } from 'next';
import { TriageView } from '@/ui/triage/TriageView';

export const metadata: Metadata = { title: 'Разбор · PS Tracker' };

export default function Page() {
  return <TriageView />;
}
