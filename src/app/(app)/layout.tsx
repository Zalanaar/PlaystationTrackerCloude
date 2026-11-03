import '@/ui/styles/app-styles';
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
import { PsnProfileProvider } from '@/ui/profiles/PsnProfileProvider';
import { SyncProvider } from '@/ui/sync/SyncProvider';

// Каркас закрытой части: шапка, баннеры синка, нижний tab bar на мобильном.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await redirectToOnboardingIfNeeded();
  return (
    <ToastProvider>
      <PsnProfileProvider>
        <SyncProvider>
          <ProfileProvider>
            <TourProvider>
              <WhatsNewProvider>
                <InstallProvider>
                  <FocusReturn />
                  {/* Фаза 48 (п. 15): ссылка «К содержимому» первой в порядке Tab */}
                  <a href="#main" className="ps-skip">К содержимому</a>
                  <AppHeader />
                  <OfflineBar />
                  <SyncBanner />
                  <main id="main" tabIndex={-1} className="ps-main ps-container">{children}</main>
                  <WhatsNew />
                  <TabBar />
                </InstallProvider>
              </WhatsNewProvider>
            </TourProvider>
          </ProfileProvider>
        </SyncProvider>
      </PsnProfileProvider>
    </ToastProvider>
  );
}
