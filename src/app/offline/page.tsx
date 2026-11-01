import type { Metadata } from 'next';
import { OfflineRetry } from '@/ui/pwa/OfflineRetry';

// Статическая заглушка без данных и без inline-скриптов (design-system §15.3): HTML кэшируется service worker'ом.
export const metadata: Metadata = { title: 'Нет сети · PS Tracker' };

export default function OfflinePage() {
  return (
    <main className="ps-offline">
      {/* eslint-disable-next-line @next/next/no-img-element -- иконка приложения, статический файл */}
      <img className="ps-offline__icon" src="/icons/icon-192.png" alt="" width={64} height={64} />
      <h1 className="ps-h1 ps-offline__title">Нет сети</h1>
      <p className="ps-offline__text">
        Эта страница недоступна без интернета. Проверьте подключение и попробуйте снова. Данные вашей коллекции мы не храним на устройстве.
      </p>
      <OfflineRetry />
      <p className="ps-offline__logo ps-micro">PS TRACKER</p>
    </main>
  );
}
