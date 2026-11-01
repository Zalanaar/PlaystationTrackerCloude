import { redirectToOnboardingIfNeeded } from './onboarding-guard';
import { ToastProvider } from '@/ui/primitives/Toast';
import { ProfileProvider } from '@/ui/profile/ProfileProvider';
import { AppHeader, TabBar } from '@/ui/shell/AppShell';
import { FocusReturn } from '@/ui/shell/FocusReturn';
import { SyncBanner } from '@/ui/shell/SyncBanner';
import { OfflineBar } from '@/ui/OfflineBar';
import { InstallProvider } from '@/ui/pwa/InstallPrompt';
import { TourProvider } from '@/ui/tour/TourProvider';
import { WhatsNew, WhatsNewProvider } from '@/ui/whatsnew/WhatsNew';
import { SyncProvider } from '@/ui/sync/SyncProvider';

// Каркас закрытой части: шапка, баннеры синка, нижний tab bar на мобильном.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await redirectToOnboardingIfNeeded();
  return (
    <SyncProvider>
      <ToastProvider>
        <ProfileProvider>
          <TourProvider>
            <WhatsNewProvider>
              <InstallProvider>
              <FocusReturn />
              <AppHeader />
              <OfflineBar />
              <SyncBanner />
              <main className="ps-main ps-container">{children}</main>
              <WhatsNew />
              <TabBar />
              </InstallProvider>
            </WhatsNewProvider>
          </TourProvider>
        </ProfileProvider>
      </ToastProvider>
    </SyncProvider>
  );
}
