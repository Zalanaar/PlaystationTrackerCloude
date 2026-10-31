-- Контрольные значения для миграции 0014 (Фаза 20.3, контракт 22.7, шаг 5). Только чтение.
-- Запустить ДО docs/release-neon-0014.sql и ПОСЛЕ него, результаты должны совпасть (после появится user_id, на значения это не влияет).
-- Не использует колонку user_id, поэтому работает в обоих состояниях.
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
ORDER BY 1;
