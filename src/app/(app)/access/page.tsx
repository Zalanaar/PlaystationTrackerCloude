import type { Metadata } from 'next';
import { AccessView } from '@/ui/access/AccessView';

export const metadata: Metadata = { title: 'Доступ · PS Tracker' };

// Только для владельца: роль проверяет API (403 -> экран 404), страница данных не содержит.
export default function Page() {
  return <AccessView />;
}
