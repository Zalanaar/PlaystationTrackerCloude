// Формат резервной копии разметки (контракт 20.3). Чистые типы и разбор без БД и сети.
import { z } from 'zod';
import { STATUS_VALUES } from '@/server/collection/validation';
import { isDateString } from '@/server/roadmap/dates';
import { GENRE_LABELS_RU } from '@/shared/genres';

export const BACKUP_APP = 'ps-tracker-backup';
/** v2 (F1): у игры есть необязательное поле `review`. Файлы v1 читаются как раньше (без оценок). */
export const BACKUP_SCHEMA_VERSION = 2;
export const SUPPORTED_VERSIONS: readonly number[] = [1, 2];
export const MAX_GAMES = 5000;
export const MAX_PLANNED = 2000;
/** Предел тела запроса восстановления в символах (≈5 МБ). */
export const MAX_BODY_CHARS = 5 * 1024 * 1024;

const iso = z.iso.datetime({ offset: true });
const GENRE_KEYS = Object.keys(GENRE_LABELS_RU) as [string, ...string[]];

const statusSchema = z
  .object({
    value: z.enum(STATUS_VALUES),
    completedAt: iso.nullable(),
    droppedAt: iso.nullable(),
    statusChangedAt: iso,
  })
  // те же CHECK, что у game_status (1.3): дата только при соответствующем статусе
  .refine((r) => (r.completedAt === null || r.value === 'completed') && (r.droppedAt === null || r.value === 'dropped'), { message: 'dates' });

const gameSchema = z.object({
  titleId: z.string().min(1).max(64),
  name: z.string().max(300).optional(),
  status: statusSchema.nullable(),
  durationOverrideHours: z.number().finite().min(0.1).max(1000).nullable(),
  genresOverride: z.array(z.enum(GENRE_KEYS)).max(20).nullable(),
  hiddenAt: iso.nullable(),
  roadmapPosition: z.number().int().min(0).max(1_000_000).nullable(),
  roadmapExcluded: z.boolean(),
  monthExclusions: z.array(z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)).max(240),
  /** v2 (F1): личная оценка 0–10 и заметка ≤500 (кодовые точки, как char_length). */
  review: z
    .object({
      rating: z.number().int().min(0).max(10).nullable(),
      note: z
        .string()
        .refine((n) => n.trim().length > 0 && [...n].length <= 500, 'note')
        .nullable(),
    })
    .refine((r) => r.rating !== null || r.note !== null, { message: 'review_empty' })
    .nullable()
    .optional(),
});

const plannedSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    releaseDate: z.string().refine(isDateString, 'date').nullable(),
    coverUrl: z
      .string()
      .max(2048)
      .refine((s) => {
        try {
          return new URL(s).protocol === 'https:';
        } catch {
          return false;
        }
      }, 'https')
      .nullable(),
    wantAtRelease: z.boolean(),
    hoursManual: z.number().finite().gt(0).max(10_000).nullable(),
    externalSource: z.literal('rawg').nullable(),
    externalId: z.string().min(1).max(64).nullable(),
    status: z.enum(['planned', 'done', 'cancelled']),
  })
  // CHECK planned_games: «хочу на релизе» требует дату, пара источник+id целиком или пусто
  .refine((p) => !p.wantAtRelease || p.releaseDate !== null, { message: 'want_release' })
  .refine((p) => (p.externalSource === null) === (p.externalId === null), { message: 'external_pair' });

const settingsSchema = z.object({ year: z.number().int().min(2000).max(2100), hoursPerWeek: z.number().finite().gt(0).max(168) });

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP),
  schemaVersion: z.number().int(),
  createdAt: iso,
  games: z.array(gameSchema).max(MAX_GAMES),
  plannedGames: z.array(plannedSchema).max(MAX_PLANNED),
  roadmapSettings: settingsSchema.nullable(),
});

export type BackupGame = z.infer<typeof gameSchema>;
export type BackupPlanned = z.infer<typeof plannedSchema>;
export type BackupFile = z.infer<typeof backupSchema>;

export type ParseFailure = { reason: 'invalid_format' | 'unsupported_version'; path?: string; got?: unknown };

/**
 * Проверка файла: сначала `app` и версия (чужой файл и новая версия дают понятные причины), затем полная схема.
 * Дубли `titleId` в файле = invalid_format.
 */
export function parseBackup(raw: unknown): { ok: true; value: BackupFile } | { ok: false; failure: ParseFailure } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, failure: { reason: 'invalid_format' } };
  const o = raw as Record<string, unknown>;
  if (o.app !== BACKUP_APP) return { ok: false, failure: { reason: 'invalid_format', path: 'app' } };
  if (typeof o.schemaVersion !== 'number' || !Number.isInteger(o.schemaVersion)) return { ok: false, failure: { reason: 'invalid_format', path: 'schemaVersion' } };
  if (!SUPPORTED_VERSIONS.includes(o.schemaVersion)) return { ok: false, failure: { reason: 'unsupported_version', got: o.schemaVersion } };
  const r = backupSchema.safeParse(raw);
  if (!r.success) return { ok: false, failure: { reason: 'invalid_format', path: r.error.issues[0]?.path.join('.') || undefined } };
  const seen = new Set<string>();
  for (const g of r.data.games) {
    if (seen.has(g.titleId)) return { ok: false, failure: { reason: 'invalid_format', path: 'games.titleId' } };
    seen.add(g.titleId);
  }
  return { ok: true, value: r.data };
}

/** Имя файла по дате (МСК, YYYY-MM-DD). */
export const backupFileName = (mskDay: string) => `ps-tracker-backup-${mskDay}.json`;
