import type { Metadata } from 'next';
import { SettingsPage } from '@/ui/settings/SettingsPage';

export const metadata: Metadata = { title: 'Настройки · PS Tracker' };

// F7 (аудит UX): один экран для темы, уведомлений, календаря и копии данных. Данные читают сами панели на клиенте.
export default function Page() {
  return <SettingsPage />;
}
