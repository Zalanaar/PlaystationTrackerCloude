// Схема БД строго по docs/api-contract.md, раздел 1.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const gameStatusValue = pgEnum('game_status_value', ['playing', 'completed', 'dropped', 'backlog', 'shelved', 'service']);
export const trophyType = pgEnum('trophy_type', ['bronze', 'silver', 'gold', 'platinum']);
export const trophySetLinkSource = pgEnum('trophy_set_link_source', ['title_id', 'concept', 'name', 'manual']);
export const syncRunKind = pgEnum('sync_run_kind', ['daily', 'manual', 'trophy_backfill']);
export const syncRunStatus = pgEnum('sync_run_status', ['running', 'success', 'partial', 'failed']);
export const syncErrorReason = pgEnum('sync_error_reason', [
  'auth_expired',
  'npsso_invalid',
  'access_denied',
  'rate_limited',
  'psn_unavailable',
  'timeout',
  'internal',
]);

export const games = pgTable(
  'games',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    titleId: text('title_id').notNull(),
    conceptId: text('concept_id'),
    name: text().notNull(),
    category: text().notNull(),
    imageUrl: text('image_url'),
    // Фаза 9 (12.1): горизонтальный арт из concept.media.images. Синк не затирает пустым.
    bannerUrl: text('banner_url'),
    psnGenres: text('psn_genres').array().notNull().default(sql`'{}'::text[]`),
    genresOverride: text('genres_override').array(),
    playDurationSeconds: integer('play_duration_seconds').notNull().default(0),
    playCount: integer('play_count').notNull().default(0),
    firstPlayedAt: tz('first_played_at'),
    lastPlayedAt: tz('last_played_at'),
    trophyCheckedAt: tz('trophy_checked_at'),
    firstSeenAt: tz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: tz('last_seen_at').notNull(),
    // Фаза 8: мягкое скрытие (9.7). Синк не трогает.
    hiddenAt: tz('hidden_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('games_title_id_key').on(t.titleId),
    index('games_concept_id_idx').on(t.conceptId),
    index('games_last_played_at_idx').on(t.lastPlayedAt.desc().nullsLast()),
    check('games_category_check', sql`${t.category} in ('ps4_game','ps5_native_game','pspc_game')`),
  ],
);

export const gameStatus = pgTable(
  'game_status',
  {
    gameId: integer('game_id')
      .primaryKey()
      .references(() => games.id, { onDelete: 'cascade' }),
    status: gameStatusValue().notNull(),
    completedAt: tz('completed_at'),
    droppedAt: tz('dropped_at'),
    statusChangedAt: tz('status_changed_at').notNull().defaultNow(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('game_status_status_idx').on(t.status),
    index('game_status_completed_at_idx').on(t.completedAt).where(sql`${t.completedAt} is not null`),
    index('game_status_dropped_at_idx').on(t.droppedAt).where(sql`${t.droppedAt} is not null`),
    check('game_status_completed_at_check', sql`${t.completedAt} is null or ${t.status} = 'completed'`),
    check('game_status_dropped_at_check', sql`${t.droppedAt} is null or ${t.status} = 'dropped'`),
  ],
);

export const trophySets = pgTable(
  'trophy_sets',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    npCommunicationId: text('np_communication_id').notNull(),
    npServiceName: text('np_service_name').notNull(),
    name: text().notNull(),
    platform: text(),
    iconUrl: text('icon_url'),
    definedBronze: integer('defined_bronze').notNull().default(0),
    definedSilver: integer('defined_silver').notNull().default(0),
    definedGold: integer('defined_gold').notNull().default(0),
    definedPlatinum: integer('defined_platinum').notNull().default(0),
    earnedBronze: integer('earned_bronze').notNull().default(0),
    earnedSilver: integer('earned_silver').notNull().default(0),
    earnedGold: integer('earned_gold').notNull().default(0),
    earnedPlatinum: integer('earned_platinum').notNull().default(0),
    progress: smallint().notNull().default(0),
    lastUpdatedAt: tz('last_updated_at'),
    trophiesSyncedAt: tz('trophies_synced_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trophy_sets_np_communication_id_key').on(t.npCommunicationId),
    check('trophy_sets_progress_check', sql`${t.progress} between 0 and 100`),
  ],
);

export const gameTrophySets = pgTable(
  'game_trophy_sets',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    trophySetId: integer('trophy_set_id')
      .notNull()
      .references(() => trophySets.id, { onDelete: 'cascade' }),
    source: trophySetLinkSource().notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.trophySetId] }),
    index('game_trophy_sets_trophy_set_id_idx').on(t.trophySetId),
  ],
);

export const trophies = pgTable(
  'trophies',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    trophySetId: integer('trophy_set_id')
      .notNull()
      .references(() => trophySets.id, { onDelete: 'cascade' }),
    trophyId: integer('trophy_id').notNull(),
    type: trophyType().notNull(),
    name: text(),
    detail: text(),
    iconUrl: text('icon_url'),
    hidden: boolean().notNull().default(false),
    earned: boolean().notNull().default(false),
    earnedAt: tz('earned_at'),
    rarity: smallint(),
    earnedRate: numeric('earned_rate', { precision: 5, scale: 2 }),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trophies_set_trophy_key').on(t.trophySetId, t.trophyId),
    index('trophies_earned_at_idx').on(t.earnedAt).where(sql`${t.earnedAt} is not null`),
    index('trophies_set_earned_idx').on(t.trophySetId, t.earned),
    check('trophies_earned_at_check', sql`${t.earned} = true or ${t.earnedAt} is null`),
  ],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    kind: syncRunKind().notNull(),
    status: syncRunStatus().notNull().default('running'),
    errorReason: syncErrorReason('error_reason'),
    errorMessage: text('error_message'),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    startedAt: tz('started_at').notNull().defaultNow(),
    finishedAt: tz('finished_at'),
    phase: text(),
    cursor: jsonb(),
    gamesSeen: integer('games_seen').notNull().default(0),
    gamesUpserted: integer('games_upserted').notNull().default(0),
    snapshotsWritten: integer('snapshots_written').notNull().default(0),
    trophySetsSynced: integer('trophy_sets_synced').notNull().default(0),
    trophiesUpserted: integer('trophies_upserted').notNull().default(0),
    warnings: jsonb(),
  },
  (t) => [
    index('sync_runs_started_at_idx').on(t.startedAt.desc()),
    // не больше одного одновременного запуска
    uniqueIndex('sync_runs_one_running_idx').on(sql`(true)`).where(sql`${t.status} = 'running'`),
  ],
);

export const playtimeSnapshots = pgTable(
  'playtime_snapshots',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    playDurationSeconds: integer('play_duration_seconds').notNull(),
    playCount: integer('play_count').notNull().default(0),
    lastPlayedAt: tz('last_played_at'),
    capturedAt: tz('captured_at').notNull().defaultNow(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('playtime_snapshots_game_date_key').on(t.gameId, t.snapshotDate),
    index('playtime_snapshots_date_idx').on(t.snapshotDate),
  ],
);

export const psnAuth = pgTable(
  'psn_auth',
  {
    id: smallint().primaryKey(),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    refreshExpiresAt: tz('refresh_expires_at'),
    accessTokenEnc: text('access_token_enc'),
    accessExpiresAt: tz('access_expires_at'),
    source: text().notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('psn_auth_singleton_check', sql`${t.id} = 1`)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    ipHash: text('ip_hash').notNull(),
    attemptedAt: tz('attempted_at').notNull().defaultNow(),
    success: boolean().notNull(),
  },
  (t) => [index('login_attempts_ip_time_idx').on(t.ipHash, t.attemptedAt.desc())],
);

// Фаза 8 (контракт 1.12): копии game_status перед сбросом всей коллекции и перед откатом. Без FK намеренно.
export const statusBackups = pgTable('status_backups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  createdAt: tz('created_at').notNull().defaultNow(),
  reason: text(),
  payload: jsonb().notNull(),
});

// Фаза 9 (контракт 12.1): профиль PSN-аккаунта, ровно одна строка (id = 1). Токенов здесь нет.
export const psnProfile = pgTable(
  'psn_profile',
  {
    id: smallint().primaryKey(),
    onlineId: text('online_id').notNull(),
    avatarUrl: text('avatar_url'),
    trophyLevel: smallint('trophy_level'),
    trophyProgress: smallint('trophy_progress'),
    trophyTier: smallint('trophy_tier'),
    earnedPlatinum: integer('earned_platinum'),
    earnedGold: integer('earned_gold'),
    earnedSilver: integer('earned_silver'),
    earnedBronze: integer('earned_bronze'),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('psn_profile_singleton_check', sql`${t.id} = 1`)],
);
