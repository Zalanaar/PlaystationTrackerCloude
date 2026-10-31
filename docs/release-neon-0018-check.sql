-- Контрольные значения для миграции 0018 (Фаза 23, контракт 25). Только чтение.
-- Запустить ДО docs/release-neon-0018.sql и ПОСЛЕ него: строки данных совпадают, zz_duplicate_columns меняется 0 -> 2.
SELECT 'games_total' AS t, count(*) AS n FROM games
UNION ALL SELECT 'games_hidden', count(*) FROM games WHERE hidden_at IS NOT NULL
UNION ALL SELECT 'statuses_total', count(*) FROM game_status
UNION ALL SELECT 'zz_duplicate_columns', count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'games' AND column_name IN ('duplicate_of_game_id', 'not_duplicate')
ORDER BY 1;
