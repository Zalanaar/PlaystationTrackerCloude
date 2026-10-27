import { SyncPanel } from '@/ui/sync/SyncPanel';
import { LogoutButton } from '@/ui/sync/LogoutButton';

// Временная главная (до Фазы 3): запуск синка. Коллекция заменит страницу, SyncPanel останется.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-container flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-text">PS Tracker</h1>
        <LogoutButton />
      </header>
      <SyncPanel />
    </main>
  );
}
