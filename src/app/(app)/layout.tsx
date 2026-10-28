import { ToastProvider } from '@/ui/primitives/Toast';
import { ProfileProvider } from '@/ui/profile/ProfileProvider';
import { AppHeader, TabBar } from '@/ui/shell/AppShell';
import { SyncBanner } from '@/ui/shell/SyncBanner';
import { SyncProvider } from '@/ui/sync/SyncProvider';

// Каркас закрытой части: шапка, баннеры синка, нижний tab bar на мобильном.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider>
      <ToastProvider>
        <ProfileProvider>
          <AppHeader />
          <SyncBanner />
          <main className="ps-main ps-container">{children}</main>
          <TabBar />
        </ProfileProvider>
      </ToastProvider>
    </SyncProvider>
  );
}
