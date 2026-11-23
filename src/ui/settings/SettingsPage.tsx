'use client';

// F7 (аудит UX): экран «Настройки». Раньше уведомления жили в панели синка под «Обновить токен вручную»,
// подписка на календарь — в «Плане», копия данных — только в меню. Здесь всё в одном месте; позже сюда же — регион магазина.
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Icon } from '../icons';
import { ThemeSwatches } from '../shell/ThemePicker';
import { CalendarSubscribe } from '../roadmap/CalendarSubscribe';
import { useEverTrue } from '../useEverTrue';

const PushPanel = dynamic(() => import('../push/PushPanel').then((m) => m.PushPanel), { ssr: false });
const RestoreFileDialog = dynamic(() => import('../backup/RestoreFileDialog').then((m) => m.RestoreFileDialog), { ssr: false });

export function SettingsPage() {
  const [restore, setRestore] = useState(false);
  const restoreEver = useEverTrue(restore);
  return (
    <div className="ps-settings" data-tour-page="settings" data-tour-ready="true">
      <header className="ps-settings__head">
        <h1 className="ps-h1 ps-h1--hdr">Настройки</h1>
        <p className="ps-settings__lead">Тема, уведомления, календарь релизов и копия данных.</p>
      </header>

      <section className="ps-panel ps-settings__sec" aria-labelledby="set-theme-h">
        <h2 className="ps-h3" id="set-theme-h">Тема</h2>
        <ThemeSwatches />
      </section>

      <section className="ps-settings__sec ps-settings__sec--bare" aria-label="Уведомления">
        <PushPanel />
      </section>

      <section className="ps-panel ps-settings__sec" aria-labelledby="set-cal-h" data-testid="settings-calendar">
        <h2 className="ps-h3" id="set-cal-h">Календарь релизов</h2>
        <p className="ps-settings__note">Релизы из «Плана» появятся в Календаре iPhone, Google или Outlook и будут обновляться сами.</p>
        <CalendarSubscribe />
      </section>

      <section className="ps-panel ps-settings__sec" aria-labelledby="set-data-h">
        <h2 className="ps-h3" id="set-data-h">Данные</h2>
        <p className="ps-settings__note">Копия — файл со статусами, оценками, заметками и планом. Из него можно всё восстановить.</p>
        <div className="ps-settings__acts">
          <a href="/api/backup" download className="ps-btn ps-btn--ghost"><Icon name="download" size={16} />Скачать копию</a>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setRestore(true)}><Icon name="upload" size={16} />Восстановить из файла</button>
        </div>
      </section>
      {restoreEver && <RestoreFileDialog open={restore} onClose={() => setRestore(false)} />}
    </div>
  );
}
