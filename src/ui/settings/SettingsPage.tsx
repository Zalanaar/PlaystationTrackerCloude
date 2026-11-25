'use client';

// F7 (аудит UX): экран «Настройки». Копия, восстановление и сброс статусов — здесь, не в меню «⋯».
// t281u: тема — только в «⋯» (П.21), подписка на календарь — в «План → Релизы» (П.8), одна кнопка «Восстановить…» с выбором источника (П.20).
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { StatusDialogs, useStatusMenu } from '../backup/StatusMenu';
import { formatDate } from '../format';
import { useEverTrue } from '../useEverTrue';

const PushPanel = dynamic(() => import('../push/PushPanel').then((m) => m.PushPanel), { ssr: false });
const RestoreFileDialog = dynamic(() => import('../backup/RestoreFileDialog').then((m) => m.RestoreFileDialog), { ssr: false });

export function SettingsPage() {
  const [restore, setRestore] = useState(false);
  const [pick, setPick] = useState(false);
  const restoreEver = useEverTrue(restore);
  const status = useStatusMenu();
  const { loadBackup } = status;
  useEffect(() => { void loadBackup(); }, [loadBackup]);
  return (
    <div className="ps-settings" data-tour-page="settings" data-tour-ready="true">
      <header className="ps-settings__head">
        <h1 className="ps-h1 ps-h1--hdr">Настройки</h1>
        <p className="ps-settings__lead">Уведомления, копия данных и сброс статусов. Тема — в меню «⋯», календарь релизов — в «План → Релизы».</p>
      </header>

      <section className="ps-settings__sec ps-settings__sec--bare" aria-label="Уведомления">
        <PushPanel />
      </section>

      <section className="ps-panel ps-settings__sec" aria-labelledby="set-data-h">
        <h2 className="ps-h3" id="set-data-h">Данные</h2>
        <p className="ps-settings__note">Копия — файл со статусами, оценками, заметками и планом. Из него можно всё восстановить.</p>
        <div className="ps-settings__acts">
          <a href="/api/backup" download className="ps-btn ps-btn--ghost"><Icon name="download" size={16} />Скачать копию</a>
          {/* П.20: одна кнопка; если есть автокопия статусов — сначала выбор источника */}
          <button
            type="button" className="ps-btn ps-btn--ghost" data-testid="settings-restore" aria-expanded={status.backup ? pick : undefined} aria-controls={status.backup ? 'set-restore-src' : undefined}
            onClick={() => (status.backup ? setPick((v) => !v) : setRestore(true))}
          >
            <Icon name="upload" size={16} />Восстановить…
          </button>
        </div>
        {status.backup && pick && (
          <div className="ps-settings__src" id="set-restore-src" role="group" aria-label="Откуда восстановить">
            <button type="button" className="ps-btn ps-btn--ghost" data-testid="restore-src-file" onClick={() => { setPick(false); setRestore(true); }}>
              <Icon name="upload" size={16} />
              <span>
                Из файла копии
                <small className="ps-settings__hint">Статусы, оценки, заметки, план</small>
              </span>
            </button>
            <button type="button" className="ps-btn ps-btn--ghost" data-testid="menu-restore-backup" onClick={() => { setPick(false); status.setRestoreOpen(true); }}>
              <Icon name="undo" size={16} />
              <span>
                Статусы из автокопии
                <small className="ps-settings__hint">Копия от {formatDate(status.backup.createdAt) ?? 'неизвестной даты'}</small>
              </span>
            </button>
          </div>
        )}
      </section>

      <section className="ps-panel ps-settings__sec ps-settings__sec--danger" aria-labelledby="set-danger-h" data-testid="settings-danger">
        <h2 className="ps-h3" id="set-danger-h">Опасная зона</h2>
        <p className="ps-settings__note">Сброс снимет статус со всех игр. Сохранится копия, её можно вернуть.</p>
        <div className="ps-settings__acts">
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--danger" data-testid="menu-reset-all" onClick={() => status.openReset()}>
            <Icon name="undo" size={16} />Сбросить все статусы…
          </button>
        </div>
      </section>
      {restoreEver && <RestoreFileDialog open={restore} onClose={() => setRestore(false)} />}
      <StatusDialogs m={status} />
    </div>
  );
}
