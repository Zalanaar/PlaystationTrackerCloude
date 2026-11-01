import type { Metadata } from 'next';
import { ProfilesPage } from '@/ui/profiles/ProfilesPage';

export const metadata: Metadata = { title: 'Профили PSN · PS Tracker' };

// Данные профилей читает клиент (GET /api/me/profiles): страница не содержит пользовательских данных.
export default function Page() {
  return <ProfilesPage />;
}
