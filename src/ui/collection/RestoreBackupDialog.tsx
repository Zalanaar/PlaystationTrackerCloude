'use client';

import { useState } from 'react';
import { formatDate, formatNumber, plural } from '../format';
import { Sheet } from '../primitives/Sheet';
import { errorText } from './api';
import type { BackupInfo } from './FilterBar';

/** Подтверждение отката статусов из последней копии `reset_all` (9.9, 9.9a). */
export function RestoreBackupDialog({
  open, backup, onClose, onConfirm,
}: {
  open: boolean;
  backup: BackupInfo | null;
  onClose: () => void;
  /** бросает ошибку = окно остаётся открытым и показывает её */
  onConfirm: (backupId: number) => Promise<void>;
}) {
  return (
    <Sheet open={open && !!backup} onClose={onClose} title="Вернуть статусы из копии">
      {open && backup && <Body backup={backup} onClose={onClose} onConfirm={onConfirm} />}
    </Sheet>
  );
}

function Body({ backup, onClose, onConfirm }: { backup: BackupInfo; onClose: () => void; onConfirm: (id: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(backup.id);
    } catch (e) {
      setErr(`Статусы не возвращены. ${errorText(e)}`);
      setBusy(false);
    }
  }

  return (
    <form className="ps-stack ps-reset" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="ps-reset__text">
        <p>
          Копия от {formatDate(backup.createdAt) ?? 'неизвестной даты'}: <b className="num">{formatNumber(backup.count)}</b> {plural(backup.count, ['статус', 'статуса', 'статусов'])}.
        </p>
        <p>Статусы и даты видимых игр станут такими, как в копии. Игры, которых в копии не было, останутся без статуса. Перед откатом текущее состояние тоже сохраняется. Скрытые игры не затрагиваются.</p>
      </div>
      {err && <p role="alert" className="ps-field-error">{err}</p>}
      <div className="ps-reset__btns">
        <button type="button" className="ps-btn" onClick={onClose}>Отмена</button>
        <button type="submit" className="ps-btn ps-btn--primary" disabled={busy}>{busy ? 'Возвращаю…' : 'Вернуть статусы'}</button>
      </div>
    </form>
  );
}
