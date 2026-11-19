-- Контрольные значения для миграции 0022 (Фаза 32, контракт 17.3a). Только чтение.
-- Запустить ДО docs/release-neon-0022.sql и ПОСЛЕ него: строки данных совпадают, zz_goal_columns меняется 0 -> 2.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'roadmap_settings_rows', count(*) FROM roadmap_settings
UNION ALL SELECT 'planned_games_rows', count(*) FROM planned_games
UNION ALL SELECT 'zz_goal_columns', count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roadmap_settings' AND column_name IN ('goal_mode', 'goal_count')
ORDER BY 1;
