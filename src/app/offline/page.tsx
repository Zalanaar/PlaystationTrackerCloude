import '@/ui/styles/app-styles';
import type { Metadata } from 'next';
import { OfflineRetry } from '@/ui/pwa/OfflineRetry';
import { OfflineSnapshotView } from '@/ui/pwa/OfflineSnapshotView';

// Экран без сети (design-system §15.3). Страница динамическая: в HTML есть inline-скрипты с nonce (тема, поток Next),
// поэтому service worker кэширует ответ вместе с CSP-заголовком, под который выписан nonce.
// Пакет 7, п. 2: в HTML данных пользователя нет; сохранённую копию (коллекция, бэклог, статистика) клиент читает из Cache Storage.
export const metadata: Metadata = { title: 'Нет сети · PS Tracker' };

export default function OfflinePage() {
  return (
    <OfflineSnapshotView
      retry={<OfflineRetry />}
      stub={(
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- иконка приложения, статический файл */}
          <img className="ps-offline__icon" src="/icons/icon-192.png" alt="" width={64} height={64} />
          <h1 className="ps-h1 ps-offline__title">Нет сети</h1>
          <p className="ps-offline__text">
            Эта страница недоступна без интернета. Проверь подключение и попробуй снова. Сохранённой копии коллекции на этом устройстве пока нет: она появится после входа с сетью.
          </p>
        </>
      )}
    />
  );
}
