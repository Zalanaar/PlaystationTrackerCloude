// Клиент резервной копии (контракт 20.3). Файл скачивается обычной ссылкой, восстановление через конверт 4.1.
import { call } from '../collection/api';
import type { BackupRestoreData } from './model';

export const BACKUP_DOWNLOAD_URL = '/api/backup';

export const postRestore = (mode: 'preview' | 'apply', backup: unknown) =>
  call<BackupRestoreData>('/api/backup/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, backup }),
  });
