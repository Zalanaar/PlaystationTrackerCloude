-- Контрольные значения для миграции 0020 (Фаза 27, контракт 28). Только чтение.
-- Запустить ДО docs/release-neon-0020.sql и ПОСЛЕ него: строки данных совпадают, zz_dismissals_table меняется 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'trophy_sets_rows', count(*) FROM trophy_sets
UNION ALL SELECT 'zz_dismissals_table', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'status_hint_dismissals'
ORDER BY 1;
