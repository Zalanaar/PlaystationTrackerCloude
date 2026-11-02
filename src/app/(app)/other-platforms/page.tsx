import type { Metadata } from 'next';
import { OtherPlatformsPage } from '@/ui/other-platforms/OtherPlatformsPage';

export const metadata: Metadata = { title: 'Играл на другой платформе · PS Tracker' };

// Список читает клиент (GET /api/manual-games?kind=other_platform): страница не содержит пользовательских данных.
export default function Page() {
  return <OtherPlatformsPage />;
}
