-- Контрольные значения для миграции 0015 (Фаза 20.3, контракт 22.7 шаг 7). Только чтение.
-- Запустить ДО docs/release-neon-0015.sql и ПОСЛЕ него. Строки без префикса zz_ (данные) должны совпасть.
-- Строки zz_*: структурные флаги, до миграции n = 0, после n = 1 (zz_other_users_rows: 0 в обоих случаях, пока нет второго пользователя).
SELECT 'games' AS t, count(*) AS n, coalesce(sum(play_duration_seconds), 0) AS s FROM games
UNION ALL SELECT 'game_status', count(*), 0 FROM game_status
UNION ALL SELECT 'trophy_sets', count(*), coalesce(sum(earned_bronze + earned_silver + earned_gold + earned_platinum), 0) FROM trophy_sets
UNION ALL SELECT 'game_trophy_sets', count(*), 0 FROM game_trophy_sets
UNION ALL SELECT 'trophies', count(*), count(*) FILTER (WHERE earned) FROM trophies
UNION ALL SELECT 'playtime_snapshots', count(*), coalesce(sum(play_duration_seconds), 0) FROM playtime_snapshots
UNION ALL SELECT 'sync_runs', count(*), 0 FROM sync_runs
UNION ALL SELECT 'psn_profile', count(*), 0 FROM psn_profile
UNION ALL SELECT 'status_backups', count(*), 0 FROM status_backups
UNION ALL SELECT 'game_month_exclusions', count(*), 0 FROM game_month_exclusions
UNION ALL SELECT 'roadmap_settings', count(*), 0 FROM roadmap_settings
UNION ALL SELECT 'planned_games', count(*), 0 FROM planned_games
UNION ALL SELECT 'roadmap_order', count(*), 0 FROM roadmap_order
UNION ALL SELECT 'roadmap_excluded', count(*), 0 FROM roadmap_excluded
UNION ALL SELECT 'recommend_dislikes', count(*), 0 FROM recommend_dislikes
UNION ALL SELECT 'recommend_reasons', count(*), 0 FROM recommend_reasons
UNION ALL SELECT 'recommend_llm_usage', count(*), coalesce(sum(calls), 0) FROM recommend_llm_usage
UNION ALL SELECT 'recommend_discover_cache', count(*), 0 FROM recommend_discover_cache
UNION ALL SELECT 'recommend_external_dislikes', count(*), 0 FROM recommend_external_dislikes
UNION ALL SELECT 'zz_other_users_rows', (SELECT count(*) FROM games WHERE user_id <> 1) + (SELECT count(*) FROM psn_profile WHERE user_id <> 1) + (SELECT count(*) FROM roadmap_settings WHERE user_id <> 1) + (SELECT count(*) FROM sync_runs WHERE user_id <> 1), 0
UNION ALL SELECT 'zz_id_columns_dropped', (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN ('psn_profile', 'roadmap_settings'))::int, 0
UNION ALL SELECT 'zz_primary_keys', (SELECT count(*) = 6 FROM pg_constraint WHERE contype = 'p' AND conname IN ('psn_profile_user_id_pk', 'roadmap_settings_user_id_pk', 'recommend_llm_usage_user_id_day_pk', 'recommend_discover_cache_user_id_day_pk', 'recommend_external_dislikes_user_id_external_source_external_id_pk', 'recommend_reasons_user_id_game_id_signals_hash_pk'))::int, 0
UNION ALL SELECT 'zz_old_indexes_gone', (SELECT count(*) = 0 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('games_title_id_key', 'trophy_sets_np_communication_id_key', 'trophies_set_trophy_key', 'playtime_snapshots_game_date_key', 'planned_games_external_key', 'psn_profile_user_key', 'roadmap_settings_user_key', 'recommend_llm_usage_user_day_key', 'recommend_discover_cache_user_day_key', 'recommend_external_dislikes_user_key', 'game_status_status_idx', 'games_concept_id_idx', 'games_last_played_at_idx', 'planned_games_status_idx', 'playtime_snapshots_date_idx', 'roadmap_order_position_idx', 'sync_runs_started_at_idx', 'trophies_earned_at_idx'))::int, 0
UNION ALL SELECT 'zz_no_user_id_defaults', (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id' AND column_default IS NOT NULL AND table_name IN ('game_month_exclusions', 'game_status', 'game_trophy_sets', 'games', 'planned_games', 'playtime_snapshots', 'psn_profile', 'recommend_discover_cache', 'recommend_dislikes', 'recommend_external_dislikes', 'recommend_llm_usage', 'recommend_reasons', 'roadmap_excluded', 'roadmap_order', 'roadmap_settings', 'status_backups', 'sync_runs', 'trophies', 'trophy_sets'))::int, 0
ORDER BY 1;
