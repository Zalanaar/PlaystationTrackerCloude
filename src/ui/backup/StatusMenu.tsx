'use client';

// Фаза 48 (п. 12): «Вернуть статусы из копии» и «Сбросить все статусы» в меню профиля (раньше в «…» и «Фильтрах» коллекции).
// Действия касаются всей коллекции, а не текущих фильтров, поэтому стоят рядом с «Скачать копию» и «Восстановить из файла».
import { useEverTrue } from '../useEverTrue';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../icons';
import { formatDate } from '../format';
import { fetchSummary } from '../collection/api';
import type { BackupInfo } from '../collection/FilterBar';
import { useStatusBackup } from '../collection/list/useStatusBackup';

const ResetAllDialog = dynamic(() => import('../collection/ResetAllDialog').then((m) => m.ResetAllDialog), { ssr: false });
const RestoreBackupDialog = dynamic(() => import('../collection/RestoreBackupDialog').then((m) => m.RestoreBackupDialog), { ssr: false });

/** Событие окна: статусы всей коллекции поменялись (сброс или откат); открытая коллекция перезагружает данные. */
export const STATUSES_CHANGED_EVENT = 'ps:statuses-changed';
const notifyStatusesChanged = () => window.dispatchEvent(new Event(STATUSES_CHANGED_EVENT));

/** Состояние пунктов и окон для шапки. */
export function useStatusMenu() {
  const s = useStatusBackup(notifyStatusesChanged);
  const { setResetOpen } = s;
  const [count, setCount] = useState<number | null>(null);
  const openReset = useCallback(() => {
    setCount(null);
    setResetOpen(true);
    fetchSummary().then((r) => setCount(r.counts.all - r.counts.none)).catch(() => { /* окно работает без числа */ });
  }, [setResetOpen]);
  return { ...s, count, openReset };
}

type Menu = ReturnType<typeof useStatusMenu>;

/** Пункты меню. Монтируются при открытии меню и тогда же читают последнюю копию. menu = роль menuitem (поповер десктопа). */
export function StatusMenuItems({ m, close, menu }: { m: Menu; close: () => void; menu: boolean }) {
  const { loadBackup, backup } = m;
  useEffect(() => { void loadBackup(); }, [loadBackup]);
  const role = menu ? 'menuitem' : undefined;
  return (
    <>
      {backup && <RestoreItem backup={backup} role={role} onClick={() => { close(); m.setRestoreOpen(true); }} />}
      <button type="button" role={role} className="ps-menu-item ps-menu-item--danger" data-testid="menu-reset-all" onClick={() => { close(); m.openReset(); }}>
        <Icon name="undo" size={16} />
        <span className="ps-menu-item__label">Сбросить все статусы…</span>
      </button>
    </>
  );
}

function RestoreItem({ backup, role, onClick }: { backup: BackupInfo; role: 'menuitem' | undefined; onClick: () => void }) {
  return (
    <button type="button" role={role} className="ps-menu-item ps-menu-item--tall" data-testid="menu-restore-backup" onClick={onClick}>
      <Icon name="undo" size={16} />
      <span className="ps-menu-item__label">
        Вернуть статусы из копии…
        <small className="ps-menu-item__hint">Копия от {formatDate(backup.createdAt) ?? 'неизвестной даты'}</small>
      </span>
    </button>
  );
}

/** Окна подтверждения: рендерятся один раз в шапке. */
export function StatusDialogs({ m }: { m: Menu }) {
  // Пакет 6: чанки окон качаются при первом открытии, не при загрузке каждой страницы
  const restoreEver = useEverTrue(m.restoreOpen);
  const resetEver = useEverTrue(m.resetOpen);
  return (
    <>
      {restoreEver && <RestoreBackupDialog open={m.restoreOpen} backup={m.backup} onClose={() => m.setRestoreOpen(false)} onConfirm={m.restoreFromMenu} />}
      {resetEver && <ResetAllDialog open={m.resetOpen} count={m.count} onClose={() => m.setResetOpen(false)} onConfirm={m.resetAll} />}
    </>
  );
}
