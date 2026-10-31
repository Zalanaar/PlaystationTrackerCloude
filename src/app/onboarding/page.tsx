import type { Metadata } from 'next';
import { OnboardingView } from '@/ui/onboarding/OnboardingView';

export const metadata: Metadata = { title: 'Подключение PlayStation · PS Tracker' };

// Вне группы (app): без вкладок и индикатора синка. Шаг определяет клиент по GET /api/me/psn.
export default async function Page({ searchParams }: { searchParams: Promise<{ recheck?: string }> }) {
  const sp = await searchParams;
  return <OnboardingView recheck={sp.recheck === '1'} />;
}
