'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatNumber } from '../../format';
import { useToast } from '../../primitives/Toast';
import { ApiError, errorText, fetchStatusBackups, postResetAll, postRestore } from '../api';
import type { BackupInfo } from '../FilterBar';
import { gamesWord, UNDO_TTL_MS } from './pool';

/** Сброс всех статусов (9.8) и откат из копии (9.9): состояние окон подтверждения и последней копии. */
export function useStatusBackup(refresh: () => void) {
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [backup, setBackup] = useState<BackupInfo | null>(null);

  /** Откат сброса всех статусов из копии (9.9). */
  const loadBackup = useCallback(async () => {
    try {
      const r = await fetchStatusBackups();
      setBackup(r.latest ? { id: r.latest.id, createdAt: r.latest.createdAt, count: r.latest.count } : null);
    } catch {
      /* пункт меню необязателен: без ответа он просто скрыт */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadBackup(), 0);
    return () => clearTimeout(t);
  }, [loadBackup]);

  const restoreBackup = useCallback(async (backupId: number) => {
    try {
      const r = await postRestore(backupId);
      setBackup(null);
      toast({ text: `Статусы возвращены: ${formatNumber(r.restored)} ${gamesWord(r.restored)}` });
    } catch (e) {
      toast({ kind: 'error', text: e instanceof ApiError && e.status === 404 ? 'Копия статусов не найдена, вернуть нельзя.' : `Не удалось вернуть статусы. ${errorText(e)}` });
    }
    refresh();
  }, [refresh, toast]);

  /** Откат из меню: ошибку показывает окно подтверждения. */
  const restoreFromMenu = useCallback(async (backupId: number) => {
    const r = await postRestore(backupId);
    setRestoreOpen(false);
    setBackup(null); // 9.9a: копия после отката остаётся на сервере, скрываем пункт сами
    toast({ text: `Статусы возвращены: ${formatNumber(r.restored)} ${gamesWord(r.restored)}` });
    refresh();
  }, [refresh, toast]);

  /** Сброс всех статусов (9.8). Ошибку показывает окно подтверждения. */
  const resetAll = useCallback(async () => {
    const r = await postResetAll();
    setResetOpen(false);
    if (r.backupId === null || r.reset === 0) {
      toast({ text: 'Сбрасывать нечего: у игр нет статусов' });
      return;
    }
    const backupId = r.backupId;
    toast({
      text: `Статусы сброшены: ${formatNumber(r.reset)} ${gamesWord(r.reset)}`, ttl: UNDO_TTL_MS,
      action: { label: 'Вернуть', run: () => void restoreBackup(backupId) },
    });
    void loadBackup();
    refresh();
  }, [loadBackup, refresh, restoreBackup, toast]);

  return { backup, resetOpen, setResetOpen, restoreOpen, setRestoreOpen, restoreFromMenu, resetAll };
}
