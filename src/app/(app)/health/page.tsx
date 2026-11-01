import type { Metadata } from 'next';
import { HealthView } from '@/ui/health/HealthView';

export const metadata: Metadata = { title: 'Здоровье · PS Tracker' };

// Только для владельца: роль проверяет API (403 -> экран 404), страница данных не содержит.
export default function Page() {
  return <HealthView />;
}
