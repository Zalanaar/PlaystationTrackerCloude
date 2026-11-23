import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Разбор · PS Tracker' };

export default function Page() {
  permanentRedirect('/triage?mode=cleanup');
}
