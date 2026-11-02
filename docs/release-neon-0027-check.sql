-- Контрольные значения для миграции 0027 (Фаза 45, отзыв сессий). Только чтение.
-- Запустить ДО docs/release-neon-0027.sql и ПОСЛЕ него: строки данных совпадают, zz_session_epoch_column и zz_revoked_sessions_table меняются 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'users_active', count(*) FROM allowed_users WHERE status = 'active'
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'manual_games_rows', count(*) FROM manual_games
UNION ALL SELECT 'zz_session_epoch_column', count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'session_epoch'
UNION ALL SELECT 'zz_revoked_sessions_table', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'revoked_sessions'
ORDER BY 1;
