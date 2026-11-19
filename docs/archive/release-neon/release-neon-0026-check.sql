-- Контрольные значения для миграции 0026 (Фаза 43, контракт 43.1). Только чтение.
-- Запустить ДО docs/release-neon-0026.sql и ПОСЛЕ него: строки данных совпадают, zz_manual_games_table меняется 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'planned_games_rows', count(*) FROM planned_games
UNION ALL SELECT 'owned_marks_rows', count(*) FROM owned_marks
UNION ALL SELECT 'zz_manual_games_table', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manual_games'
ORDER BY 1;
