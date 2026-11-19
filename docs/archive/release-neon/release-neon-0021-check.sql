-- Контрольные значения для миграции 0021 (Фаза 29, контракт F29). Только чтение.
-- Запустить ДО docs/release-neon-0021.sql и ПОСЛЕ него: строки данных совпадают, zz_digest_tables меняется 0 -> 4.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'notify_log_rows', count(*) FROM notify_log
UNION ALL SELECT 'zz_digest_tables', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('telegram_chats', 'telegram_link_codes', 'telegram_link_attempts', 'digest_state')
ORDER BY 1;
