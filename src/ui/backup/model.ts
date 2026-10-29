// Чистая логика копии разметки (контракт 20.3): типы ответа, тексты ошибок, подписи секций. Без React и сети.
import type { RestoreResult } from '@/server/backup/restore';
import { plural } from '../format';

export type BackupRestoreData = RestoreResult & { mode: 'preview' | 'apply'; schemaVersion: number; fileCreatedAt: string };
export type SectionKey = keyof BackupRestoreData['sections'];

/** Предел тела восстановления (контракт 20.3): 5 МБ. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export const SECTION_LABEL: Record<SectionKey, string> = {
  status: 'Статусы игр',
  duration: 'Длительность прохождения',
  genres: 'Жанры вручную',
  hidden: 'Скрытые игры',
  roadmapOrder: 'Порядок в плане',
  roadmapExcluded: 'Исключения из плана',
  monthExclusions: 'Исключённые месяцы',
  plannedGames: 'Планируемые игры',
  roadmapSettings: 'Настройки плана',
};

export const SECTION_ORDER: readonly SectionKey[] = [
  'status', 'duration', 'genres', 'hidden', 'roadmapOrder', 'roadmapExcluded', 'monthExclusions', 'plannedGames', 'roadmapSettings',
];

const STATUS_RU: Record<string, string> = {
  playing: 'играю', completed: 'пройдено', dropped: 'брошено', backlog: 'бэклог', shelved: 'отложено', service: 'сервис',
};

/** Значение `from`/`to` в списке изменений: статусы и признаки по-русски, остальное как есть. */
export function changeValue(section: string, v: string | null): string {
  if (v === null) return 'нет';
  if (section === 'status') return STATUS_RU[v] ?? v;
  if (section === 'hidden') return v === 'hidden' ? 'скрыта' : v === 'visible' ? 'видна' : v;
  if (section === 'duration') return `${v} ч`;
  if (v === 'added') return 'добавлено';
  return v;
}

export function changeLine(c: { section: string; kind: string; from: string | null; to: string }): string {
  return c.kind === 'add' ? changeValue(c.section, c.to) : `${changeValue(c.section, c.from)} → ${changeValue(c.section, c.to)}`;
}

export function totalChanges(d: Pick<BackupRestoreData, 'sections'>): number {
  return Object.values(d.sections).reduce((n, s) => n + s.add + s.change, 0);
}

export function changesText(n: number): string {
  return `${n} ${plural(n, ['изменение', 'изменения', 'изменений'])}`;
}

/** Ошибка по `details.reason` (контракт 20.3) человеческим русским текстом. */
export function restoreErrorText(status: number, code: string | undefined, reason: string | undefined): string {
  if (reason === 'invalid_json') return 'Файл не читается: это не JSON.';
  if (reason === 'invalid_format') return 'Это не файл копии PS Tracker или он повреждён.';
  if (reason === 'unsupported_version') return 'Эта версия файла копии не поддерживается.';
  if (reason === 'too_large') return 'Файл слишком большой (больше 5 МБ).';
  if (status === 503 || code === 'db_unavailable') return 'База данных недоступна. Попробуй позже.';
  if (status === 401) return 'Сессия истекла. Войди заново.';
  if (status === 403) return 'Запрос отклонён. Обнови страницу и попробуй снова.';
  if (status === 0 || code === 'network') return 'Нет связи с сервером.';
  return 'Не удалось выполнить восстановление.';
}

/** Проверка файла до отправки; null = можно слать. Возвращает уже русский текст. */
export function parseBackupFile(text: string, size: number): { ok: true; value: unknown } | { ok: false; error: string } {
  if (size > MAX_BACKUP_BYTES) return { ok: false, error: restoreErrorText(400, 'invalid_request', 'too_large') };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: restoreErrorText(400, 'invalid_request', 'invalid_json') };
  }
}
