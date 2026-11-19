-- Контрольные значения для миграции 0024 (Фаза 40, контракт 40.1). Только чтение.
-- Запустить ДО docs/release-neon-0024.sql и ПОСЛЕ него: строки данных совпадают, zz_owned_marks_table меняется 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'trophy_sets_rows', count(*) FROM trophy_sets
UNION ALL SELECT 'external_dislikes_rows', count(*) FROM recommend_external_dislikes
UNION ALL SELECT 'zz_owned_marks_table', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'owned_marks'
ORDER BY 1;
