-- Контрольные значения для миграции 0019 (Фаза 24, контракт 27). Только чтение.
-- Запустить ДО docs/release-neon-0019.sql и ПОСЛЕ него: строки данных совпадают, zz_events_table меняется 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'login_attempts_rows', count(*) FROM login_attempts
UNION ALL SELECT 'psn_auth_rows', count(*) FROM psn_auth
UNION ALL SELECT 'zz_events_table', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'psn_token_events'
ORDER BY 1;
