-- Контрольные значения для миграции 0023 (Фаза 32.1, контракт 8.8). Только чтение.
-- Запустить ДО docs/release-neon-0023.sql и ПОСЛЕ него: строки данных совпадают, zz_cancelled_enum меняется 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'sync_runs_total', count(*) FROM sync_runs
UNION ALL SELECT 'sync_runs_failed', count(*) FROM sync_runs WHERE status = 'failed'
UNION ALL SELECT 'zz_cancelled_enum', count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'sync_error_reason' AND e.enumlabel = 'cancelled'
ORDER BY 1;
