import '@/ui/styles/app-styles';
import type { Metadata } from 'next';
import { NotFound } from '@/ui/NotFound';

export const metadata: Metadata = { title: 'Не найдено · PS Tracker' };

export default function RootNotFound() {
  return <NotFound root />;
}
