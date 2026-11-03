// Схема БД строго по docs/api-contract.md, раздел 1.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
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

// Фаза 20 (контракт 22.1, миграция 0015 «contract»): владелец пользовательской строки. Без default: код передаёт user_id явно.
const userIdCol = () =>
  integer('user_id')
    .notNull()
    .references((): AnyPgColumn => allowedUsers.id, { onDelete: 'cascade' });

export const gameStatusValue = pgEnum('game_status_value', ['playing', 'completed', 'dropped', 'backlog', 'shelved', 'service']);
export const trophyType = pgEnum('trophy_type', ['bronze', 'silver', 'gold', 'platinum']);
export const trophySetLinkSource = pgEnum('trophy_set_link_source', ['title_id', 'concept', 'name', 'manual']);
export const syncRunKind = pgEnum('sync_run_kind', ['daily', 'manual', 'trophy_backfill', 'hltb']);
export const syncRunStatus = pgEnum('sync_run_status', ['running', 'success', 'partial', 'failed']);
export const syncErrorReason = pgEnum('sync_error_reason', [
  'auth_expired',
  'npsso_invalid',
  'access_denied',
  'rate_limited',
  'psn_unavailable',
  'timeout',
  'internal',
  'cancelled',
]);

export const games = pgTable(
  'games',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: userIdCol(),
    titleId: text('title_id').notNull(),
    conceptId: text('concept_id'),
    name: text().notNull(),
    category: text().notNull(),
    imageUrl: text('image_url'),
    // Фаза 9 (12.1): горизонтальный арт из concept.media.images. Синк не затирает пустым.
    bannerUrl: text('banner_url'),
    // Этап 2 (контракт 15.2): акцент из обложки, #rrggbb или NULL. tint_checked_at: когда последний раз пытались посчитать.
    tint: text(),
    tintCheckedAt: tz('tint_checked_at'),
    // Фаза 11 (контракт 16.1): длительность прохождения. Ручная (duration_override_hours) приоритетнее HLTB.
    hltbId: integer('hltb_id'),
    hltbName: text('hltb_name'),
    hltbMainHours: doublePrecision('hltb_main_hours'),
    hltbExtraHours: doublePrecision('hltb_extra_hours'),
    hltbCheckedAt: tz('hltb_checked_at'),
    durationOverrideHours: doublePrecision('duration_override_hours'),
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
    // Фаза 23 (контракт 25.1): дубль главной игры (та же игра на другой платформе). Пишет синк и POST .../not-duplicate. not_duplicate синк не трогает.
    duplicateOfGameId: integer('duplicate_of_game_id'),
    notDuplicate: boolean('not_duplicate').notNull().default(false),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'games_duplicate_of_fk', columns: [t.userId, t.duplicateOfGameId], foreignColumns: [t.userId, t.id] }),
    index('games_user_duplicate_of_idx').on(t.userId, t.duplicateOfGameId).where(sql`${t.duplicateOfGameId} is not null`),
    check('games_duplicate_self_check', sql`${t.duplicateOfGameId} is null or ${t.duplicateOfGameId} <> ${t.id}`),
    // составные ключи для user-scoped потомков и upsert по (user_id, title_id); глобальные title_id/concept_id/last_played_at убраны в 0015
    uniqueIndex('games_user_title_id_key').on(t.userId, t.titleId),
    uniqueIndex('games_user_id_id_key').on(t.userId, t.id),
    index('games_user_concept_id_idx').on(t.userId, t.conceptId),
    index('games_user_last_played_at_idx').on(t.userId, t.lastPlayedAt.desc().nullsLast()),
    check('games_category_check', sql`${t.category} in ('ps4_game','ps5_native_game','pspc_game')`),
    check('games_tint_check', sql`${t.tint} is null or ${t.tint} ~ '^#[0-9a-f]{6}$'`),
    check('games_hltb_main_check', sql`${t.hltbMainHours} is null or ${t.hltbMainHours} > 0`),
    check('games_hltb_extra_check', sql`${t.hltbExtraHours} is null or ${t.hltbExtraHours} > 0`),
    check('games_duration_override_check', sql`${t.durationOverrideHours} is null or ${t.durationOverrideHours} > 0`),
  ],
);

export const gameStatus = pgTable(
  'game_status',
  {
    gameId: integer('game_id')
      .primaryKey()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    status: gameStatusValue().notNull(),
    completedAt: tz('completed_at'),
    droppedAt: tz('dropped_at'),
    statusChangedAt: tz('status_changed_at').notNull().defaultNow(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('game_status_user_status_idx').on(t.userId, t.status),
    foreignKey({ name: 'game_status_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
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
    userId: userIdCol(),
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
    uniqueIndex('trophy_sets_user_np_key').on(t.userId, t.npCommunicationId),
    uniqueIndex('trophy_sets_user_id_id_key').on(t.userId, t.id),
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
    userId: userIdCol(),
    source: trophySetLinkSource().notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.trophySetId] }),
    index('game_trophy_sets_trophy_set_id_idx').on(t.trophySetId),
    index('game_trophy_sets_user_game_idx').on(t.userId, t.gameId),
    foreignKey({ name: 'game_trophy_sets_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    foreignKey({ name: 'game_trophy_sets_user_set_fk', columns: [t.userId, t.trophySetId], foreignColumns: [trophySets.userId, trophySets.id] }).onDelete('cascade'),
  ],
);

export const trophies = pgTable(
  'trophies',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    trophySetId: integer('trophy_set_id')
      .notNull()
      .references(() => trophySets.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    trophyId: integer('trophy_id').notNull(),
    // Этап 2 (контракт 15.3): PSN trophyGroupId, 'default' = база, '001'... = DLC, NULL = ещё не загружено.
    groupId: text('group_id'),
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
    uniqueIndex('trophies_user_set_trophy_key').on(t.userId, t.trophySetId, t.trophyId),
    index('trophies_user_earned_at_idx').on(t.userId, t.earnedAt).where(sql`${t.earnedAt} is not null`),
    foreignKey({ name: 'trophies_user_set_fk', columns: [t.userId, t.trophySetId], foreignColumns: [trophySets.userId, trophySets.id] }).onDelete('cascade'),
    index('trophies_set_earned_idx').on(t.trophySetId, t.earned),
    check('trophies_earned_at_check', sql`${t.earned} = true or ${t.earnedAt} is null`),
  ],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: userIdCol(),
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
    index('sync_runs_user_started_at_idx').on(t.userId, t.startedAt.desc()),
    // не больше одного одновременного запуска
    uniqueIndex('sync_runs_one_running_idx').on(sql`(true)`).where(sql`${t.status} = 'running'`),
  ],
);

// Массовая подгрузка длительности HLTB (контракт 16.7) отдельно от синка (п. 3): свой слот running, не мешает синку и обходу cron.
// Раньше такие запуски шли в sync_runs (kind='hltb') и занимали единственный слот синка; старые строки там остаются историей.
export const hltbRuns = pgTable(
  'hltb_runs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: userIdCol(),
    status: syncRunStatus().notNull().default('running'),
    errorReason: syncErrorReason('error_reason'),
    errorMessage: text('error_message'),
    startedAt: tz('started_at').notNull().defaultNow(),
    finishedAt: tz('finished_at'),
    /** heartbeat после каждой пачки: брошенный запуск закрывается через 2 минуты */
    heartbeatAt: tz('heartbeat_at').notNull().defaultNow(),
    gamesSeen: integer('games_seen').notNull().default(0),
    gamesUpserted: integer('games_upserted').notNull().default(0),
    warnings: jsonb(),
  },
  (t) => [
    index('hltb_runs_user_started_at_idx').on(t.userId, t.startedAt.desc()),
    // один массовый прогон HLTB на всю систему (нагрузка на HLTB как раньше), независимо от слота синка
    uniqueIndex('hltb_runs_one_running_idx').on(sql`(true)`).where(sql`${t.status} = 'running'`),
  ],
);

export const playtimeSnapshots = pgTable(
  'playtime_snapshots',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    playDurationSeconds: integer('play_duration_seconds').notNull(),
    playCount: integer('play_count').notNull().default(0),
    lastPlayedAt: tz('last_played_at'),
    capturedAt: tz('captured_at').notNull().defaultNow(),
    syncRunId: integer('sync_run_id').references(() => syncRuns.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('playtime_snapshots_user_game_date_key').on(t.userId, t.gameId, t.snapshotDate),
    index('playtime_snapshots_user_date_idx').on(t.userId, t.snapshotDate),
    foreignKey({ name: 'playtime_snapshots_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
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

// Фаза 24 (контракт 27.3): журнал событий токена PSN. Глобальный, как psn_auth; user_id = кто вставил NPSSO (только pasted).
export const psnTokenEvents = pgTable(
  'psn_token_events',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id').references((): AnyPgColumn => allowedUsers.id, { onDelete: 'set null' }),
    event: text().notNull(),
    details: jsonb(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('psn_token_events_created_idx').on(t.createdAt.desc(), t.id.desc()),
    check('psn_token_events_event_check', sql`${t.event} in ('pasted','refreshed','expired','from_env')`),
  ],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    ipHash: text('ip_hash').notNull(),
    attemptedAt: tz('attempted_at').notNull().defaultNow(),
    success: boolean().notNull(),
    // Фаза 20 (контракт 22.1): счётчики пароля и Google независимы
    kind: text().notNull().default('password'),
  },
  (t) => [
    index('login_attempts_ip_time_idx').on(t.ipHash, t.attemptedAt.desc()),
    check('login_attempts_kind_check', sql`${t.kind} in ('password','google','npsso')`),
  ],
);

// Фаза 20 (контракт 22.2): белый список = пользователи. id == userId.
export const allowedUsers = pgTable(
  'allowed_users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull(),
    role: text().notNull().default('member'),
    status: text().notNull().default('invited'),
    googleSub: text('google_sub'),
    displayName: text('display_name'),
    psnOnlineId: text('psn_online_id'),
    psnAccountId: text('psn_account_id'),
    psnAccessMode: text('psn_access_mode').notNull().default('public'),
    psnAccessStatus: text('psn_access_status').notNull().default('unchecked'),
    psnAccessCheckedAt: tz('psn_access_checked_at'),
    onboardedAt: tz('onboarded_at'),
    // Фаза 21 (контракт 23.2): версия тура, пройденная или пропущенная пользователем
    tourVersion: integer('tour_version'),
    tourCompletedAt: tz('tour_completed_at'),
    lastLoginAt: tz('last_login_at'),
    invitedBy: integer('invited_by').references((): AnyPgColumn => allowedUsers.id, { onDelete: 'set null' }),
    // Фаза 41 (контракт 41.1): NULL = основной профиль (вход), иначе id основного. Вход строки = coalesce(primary_user_id, id)
    primaryUserId: integer('primary_user_id').references((): AnyPgColumn => allowedUsers.id, { onDelete: 'cascade' }),
    // Фаза 41: момент отвязки профиля (status = 'archived')
    archivedAt: tz('archived_at'),
    // Фаза 45 (отзыв сессий): эпоха сессий входа; «Выйти на всех устройствах» увеличивает её, сессии с другой эпохой отклоняются
    sessionEpoch: integer('session_epoch').notNull().default(0),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('allowed_users_email_primary_key').on(t.email).where(sql`${t.primaryUserId} is null`),
    uniqueIndex('allowed_users_psn_account_key').on(t.psnAccountId).where(sql`${t.psnAccountId} is not null and ${t.status} <> 'archived'`),
    uniqueIndex('allowed_users_psn_online_key')
      .on(sql`lower(${t.psnOnlineId})`)
      .where(sql`${t.psnOnlineId} is not null and ${t.status} <> 'archived'`),
    index('allowed_users_primary_idx').on(t.primaryUserId).where(sql`${t.primaryUserId} is not null`),
    uniqueIndex('allowed_users_google_sub_key').on(t.googleSub).where(sql`${t.googleSub} is not null`),
    uniqueIndex('allowed_users_single_owner_key').on(sql`(true)`).where(sql`${t.role} = 'owner'`),
    check('allowed_users_role_check', sql`${t.role} in ('owner','member')`),
    check('allowed_users_status_check', sql`${t.status} in ('invited','active','blocked','archived')`),
    check('allowed_users_psn_access_mode_check', sql`${t.psnAccessMode} in ('public','friend')`),
    check(
      'allowed_users_psn_access_status_check',
      sql`${t.psnAccessStatus} in ('unchecked','ok','private','not_found','friend_required','unavailable')`,
    ),
    check('allowed_users_email_check', sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+$' and char_length(${t.email}) <= 254`),
    check('allowed_users_owner_not_blocked_check', sql`${t.role} <> 'owner' or ${t.status} <> 'blocked'`),
    check(
      'allowed_users_profile_check',
      sql`(${t.primaryUserId} is null or (${t.primaryUserId} <> ${t.id} and ${t.role} = 'member' and ${t.googleSub} is null)) and ((${t.status} = 'archived') = (${t.archivedAt} is not null)) and (${t.status} <> 'archived' or ${t.primaryUserId} is not null)`,
    ),
  ],
);

// Фаза 45: отозванные сессии («Выйти»). sid из cookie; строка нужна только до истечения сессии, просроченные удаляются при следующем выходе.
export const revokedSessions = pgTable(
  'revoked_sessions',
  {
    sid: text().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references((): AnyPgColumn => allowedUsers.id, { onDelete: 'cascade' }),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at').notNull().defaultNow(),
  },
  (t) => [index('revoked_sessions_expires_idx').on(t.expiresAt)],
);

// Фаза 8 (контракт 1.12): копии game_status перед сбросом всей коллекции и перед откатом. Без FK намеренно.
export const statusBackups = pgTable(
  'status_backups',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: userIdCol(),
    createdAt: tz('created_at').notNull().defaultNow(),
    reason: text(),
    payload: jsonb().notNull(),
  },
  (t) => [index('status_backups_user_created_idx').on(t.userId, t.createdAt.desc())],
);

// Фаза 9 (контракт 12.1): профиль PSN-аккаунта, одна строка на пользователя (PK user_id, 0015). Токенов здесь нет.
export const psnProfile = pgTable(
  'psn_profile',
  {
    userId: userIdCol(),
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
  (t) => [primaryKey({ columns: [t.userId] })],
);

// Этап 2 (контракт 15.1): исключение игры из месяца статистики. month = 'YYYY-MM' (МСК). Синк не трогает.
export const gameMonthExclusions = pgTable(
  'game_month_exclusions',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    month: text().notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.month] }),
    foreignKey({ name: 'game_month_exclusions_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    check('game_month_exclusions_month_check', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

// Этап 2 (контракт 15.4): когда последний раз слали уведомление каждого типа (дедуп: раз в сутки МСК).
export const notifyLog = pgTable('notify_log', {
  kind: text().primaryKey(),
  lastSentAt: tz('last_sent_at').notNull(),
  sentOn: date('sent_on', { mode: 'string' }).notNull(),
});

// Фаза 12 (контракт 17.1): роадмап бэклога. Миграция 0008 только добавляет таблицы.
// Настройки плана, одна строка на пользователя (PK user_id, 0015).
export const roadmapSettings = pgTable(
  'roadmap_settings',
  {
    userId: userIdCol(),
    year: smallint().notNull(),
    hoursPerWeek: doublePrecision('hours_per_week').notNull(),
    // Фаза 32 (N2): цель года в штуках. NULL = цели нет (контракт 17.1).
    goalMode: text('goal_mode'),
    goalCount: smallint('goal_count'),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId] }),
    check('roadmap_settings_goal_mode_check', sql`${t.goalMode} is null or ${t.goalMode} in ('complete', 'backlog_to')`),
    check('roadmap_settings_goal_count_check', sql`${t.goalCount} is null or (${t.goalCount} >= 0 and ${t.goalCount} <= 1000)`),
    check('roadmap_settings_goal_pair_check', sql`(${t.goalMode} is null) = (${t.goalCount} is null)`),
    check('roadmap_settings_year_check', sql`${t.year} >= 2000 and ${t.year} <= 2100`),
    check('roadmap_settings_hours_check', sql`${t.hoursPerWeek} > 0 and ${t.hoursPerWeek} <= 168`),
  ],
);

// Невышедшие / ещё не купленные игры, вводятся вручную (часы только ручные).
export const plannedGames = pgTable(
  'planned_games',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: userIdCol(),
    title: text().notNull(),
    releaseDate: date('release_date', { mode: 'string' }),
    coverUrl: text('cover_url'),
    wantAtRelease: boolean('want_at_release').notNull().default(false),
    hoursManual: doublePrecision('hours_manual'),
    externalSource: text('external_source'),
    externalId: text('external_id'),
    status: text().notNull().default('planned'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('planned_games_user_external_key')
      .on(t.userId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('planned_games_user_status_idx').on(t.userId, t.status),
    check('planned_games_want_release_check', sql`not ${t.wantAtRelease} or ${t.releaseDate} is not null`),
    check('planned_games_hours_check', sql`${t.hoursManual} is null or ${t.hoursManual} > 0`),
    check('planned_games_source_check', sql`${t.externalSource} is null or ${t.externalSource} = 'rawg'`),
    check('planned_games_external_pair_check', sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
    check('planned_games_status_check', sql`${t.status} in ('planned', 'done', 'cancelled')`),
  ],
);

// Ручной порядок очереди бэклога (игры со статусом backlog).
export const roadmapOrder = pgTable(
  'roadmap_order',
  {
    gameId: integer('game_id')
      .primaryKey()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    position: integer().notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('roadmap_order_user_position_idx').on(t.userId, t.position),
    foreignKey({ name: 'roadmap_order_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    check('roadmap_order_position_check', sql`${t.position} >= 0`),
  ],
);

// Правка Фазы 12 (контракт 17.12, миграция 0009): игры бэклога, убранные из плана («Не распределено»). Статус игры не меняется.
export const roadmapExcluded = pgTable(
  'roadmap_excluded',
  {
    gameId: integer('game_id')
      .primaryKey()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [foreignKey({ name: 'roadmap_excluded_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade')],
);

// Фаза 13 (контракт 18.1, миграция 0010): «Подскажи». Миграция только добавляет таблицы.
// Игры, отмеченные «Не интересно»: не попадают в рекомендации. Статус игры не меняется.
export const recommendDislikes = pgTable(
  'recommend_dislikes',
  {
    gameId: integer('game_id')
      .primaryKey()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [foreignKey({ name: 'recommend_dislikes_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade')],
);

// Кэш фраз LLM: живёт, пока не изменился хэш сигналов; запись старше 7 суток игнорируется.
export const recommendReasons = pgTable(
  'recommend_reasons',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: userIdCol(),
    signalsHash: text('signals_hash').notNull(),
    text: text().notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // 0015: PK с user_id (контракт 22.1): upsert с чужим user_id станет вставкой и упадёт на составном FK, а не перезапишет чужую строку
    primaryKey({ columns: [t.userId, t.gameId, t.signalsHash] }),
    foreignKey({ name: 'recommend_reasons_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    check('recommend_reasons_text_check', sql`char_length(${t.text}) between 1 and 400`),
  ],
);

// Счётчик реальных вызовов LLM по суткам МСК (дневной лимит).
export const recommendLlmUsage = pgTable(
  'recommend_llm_usage',
  {
    day: date({ mode: 'string' }).notNull(),
    userId: userIdCol(),
    // Всего за сутки (общий предохранитель LLM_DAILY_LIMIT). С Этапа 5 (контракт 20.4) ниже счётчики по видам вызова.
    calls: integer().notNull().default(0),
    phraseCalls: integer('phrase_calls').notNull().default(0),
    discoverAutoCalls: integer('discover_auto_calls').notNull().default(0),
    discoverManualCalls: integer('discover_manual_calls').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    check('recommend_llm_usage_calls_check', sql`${t.calls} >= 0`),
    check('recommend_llm_usage_phrase_calls_check', sql`${t.phraseCalls} >= 0`),
    check('recommend_llm_usage_discover_auto_calls_check', sql`${t.discoverAutoCalls} >= 0`),
    check('recommend_llm_usage_discover_manual_calls_check', sql`${t.discoverManualCalls} >= 0`),
  ],
);

// Хвост 20.5 (контракт 24, миграция 0017): исходящие запросы к RAWG и HLTB по пользователям и суткам МСК.
export const providerUsage = pgTable(
  'provider_usage',
  {
    userId: userIdCol(),
    day: date({ mode: 'string' }).notNull(),
    provider: text().notNull(),
    calls: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day, t.provider] }),
    check('provider_usage_provider_check', sql`${t.provider} in ('rawg', 'hltb')`),
    check('provider_usage_calls_check', sql`${t.calls} >= 0`),
  ],
);

// Этап 5 (контракт 20.4, миграция 0012): подряд идущие неудачные вызовы LLM, ровно одна строка (id = 1).
// fail_streak >= 3 = пауза до следующего синка (синк обнуляет в начале шага LLM).
export const recommendLlmState = pgTable(
  'recommend_llm_state',
  {
    id: smallint().primaryKey(),
    failStreak: integer('fail_streak').notNull().default(0),
    lastReason: text('last_reason'),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('recommend_llm_state_singleton_check', sql`${t.id} = 1`), check('recommend_llm_state_streak_check', sql`${t.failStreak} >= 0`)],
);

// Фаза 13b (контракт 19.1, миграция 0011): «Новое от ИИ». Миграция только добавляет таблицы.
// Кэш подтверждённых RAWG кандидатов по суткам МСК. refreshes: сколько раз за сутки использован ?refresh=1 (не больше 3).
export const recommendDiscoverCache = pgTable(
  'recommend_discover_cache',
  {
    day: date({ mode: 'string' }).notNull(),
    userId: userIdCol(),
    profileHash: text('profile_hash').notNull(),
    payload: jsonb().notNull(),
    refreshes: integer().notNull().default(0),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    check('recommend_discover_cache_refreshes_check', sql`${t.refreshes} >= 0`),
  ],
);

// «Не интересно» для внешних игр (RAWG). Срок как у recommend_dislikes (DISLIKE_TTL_DAYS), повторный POST продлевает.
export const recommendExternalDislikes = pgTable(
  'recommend_external_dislikes',
  {
    userId: userIdCol(),
    externalSource: text('external_source').notNull(),
    externalId: text('external_id').notNull(),
    title: text().notNull(),
    coverUrl: text('cover_url'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.externalSource, t.externalId] }),
    check('recommend_external_dislikes_source_check', sql`${t.externalSource} = 'rawg'`),
    check('recommend_external_dislikes_title_check', sql`char_length(${t.title}) between 1 and 200`),
  ],
);

// Фаза 27 (контракт 28.1, миграция 0020): «не предлагать для этой игры по правилу». Только отказы, сами подсказки считаются на лету.
export const statusHintDismissals = pgTable(
  'status_hint_dismissals',
  {
    userId: userIdCol(),
    gameId: integer('game_id').notNull(),
    rule: text().notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gameId, t.rule] }),
    foreignKey({ name: 'status_hint_dismissals_user_game_fk', columns: [t.userId, t.gameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    check('status_hint_dismissals_rule_check', sql`${t.rule} in ('started','stale','platinum','returned')`),
  ],
);

// Фаза 29 (контракт F29.1, миграция 0021): сводка в Telegram. Привязка чата, коды, лимит попыток, состояние сводки.
export const telegramChats = pgTable(
  'telegram_chats',
  {
    userId: integer('user_id')
      .primaryKey()
      .references((): AnyPgColumn => allowedUsers.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    linkedAt: tz('linked_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('telegram_chats_chat_id_key').on(t.chatId), check('telegram_chats_chat_id_check', sql`${t.chatId} ~ '^-?[0-9]{1,20}$'`)],
);

export const telegramLinkCodes = pgTable(
  'telegram_link_codes',
  {
    userId: integer('user_id')
      .primaryKey()
      .references((): AnyPgColumn => allowedUsers.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('telegram_link_codes_code_hash_key').on(t.codeHash)],
);

export const telegramLinkAttempts = pgTable(
  'telegram_link_attempts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    chatId: text('chat_id').notNull(),
    attemptedAt: tz('attempted_at').notNull().defaultNow(),
  },
  (t) => [index('telegram_link_attempts_chat_idx').on(t.chatId, t.attemptedAt)],
);

export const digestState = pgTable('digest_state', {
  userId: integer('user_id')
    .primaryKey()
    .references((): AnyPgColumn => allowedUsers.id, { onDelete: 'cascade' }),
  lastSentAt: tz('last_sent_at'),
  lastWeek: text('last_week'),
  lastAdviceGameId: integer('last_advice_game_id'),
});

// Фаза 40 (контракт 40.1, миграция 0024): «Уже есть / проходил». Ключ внешней игры — rawg_id (title_key только справочный).
// covered_by_game_id: игра библиотеки этого же пользователя (составной FK), одна игра покрывает много внешних (1 -> много).
export const ownedMarks = pgTable(
  'owned_marks',
  {
    userId: userIdCol(),
    rawgId: text('rawg_id').notNull(),
    title: text().notNull(),
    titleKey: text('title_key').notNull(),
    coverUrl: text('cover_url'),
    coveredByGameId: integer('covered_by_game_id'),
    completed: boolean().notNull().default(false),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.rawgId] }),
    foreignKey({ name: 'owned_marks_user_game_fk', columns: [t.userId, t.coveredByGameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    index('owned_marks_user_covered_idx').on(t.userId, t.coveredByGameId).where(sql`${t.coveredByGameId} is not null`),
    check('owned_marks_title_check', sql`char_length(${t.title}) between 1 and 200`),
    check('owned_marks_covered_completed', sql`${t.coveredByGameId} is null or ${t.completed} = false`),
  ],
);

// Фаза 43 (контракт 43.1, миграция 0026): игры вне библиотеки PSN, добавленные вручную через поиск RAWG.
// kind = ps_backlog («не куплено» в Бэклоге) | other_platform (Фаза 44). Ключ внешней игры — rawg_id. linked_game_id: игра библиотеки,
// с которой запись склеена (после этого запись отдельно не показывается). suggested_game_id / rejected_game_ids: вопрос «Это та игра?» во «Входящих».
export const manualGames = pgTable(
  'manual_games',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: userIdCol(),
    rawgId: text('rawg_id').notNull(),
    title: text().notNull(),
    coverUrl: text('cover_url'),
    releaseDate: date('release_date', { mode: 'string' }),
    kind: text().notNull(),
    notPurchased: boolean('not_purchased').notNull().default(false),
    linkedGameId: integer('linked_game_id'),
    suggestedGameId: integer('suggested_game_id'),
    rejectedGameIds: integer('rejected_game_ids').array().notNull().default(sql`'{}'::integer[]`),
    platformLabel: text('platform_label'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('manual_games_user_rawg_kind_key').on(t.userId, t.rawgId, t.kind),
    foreignKey({ name: 'manual_games_user_linked_fk', columns: [t.userId, t.linkedGameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    foreignKey({ name: 'manual_games_user_suggested_fk', columns: [t.userId, t.suggestedGameId], foreignColumns: [games.userId, games.id] }).onDelete('cascade'),
    index('manual_games_user_kind_idx').on(t.userId, t.kind),
    index('manual_games_user_suggested_idx').on(t.userId, t.suggestedGameId).where(sql`${t.suggestedGameId} is not null`),
    check('manual_games_title_check', sql`char_length(${t.title}) between 1 and 200`),
    check('manual_games_kind_check', sql`${t.kind} in ('ps_backlog','other_platform')`),
    check('manual_games_not_purchased_check', sql`${t.kind} = 'ps_backlog' or ${t.notPurchased} = false`),
    check('manual_games_linked_check', sql`${t.linkedGameId} is null or (${t.notPurchased} = false and ${t.suggestedGameId} is null)`),
    check('manual_games_platform_label_check', sql`${t.platformLabel} is null or char_length(${t.platformLabel}) between 1 and 60`),
  ],
);
