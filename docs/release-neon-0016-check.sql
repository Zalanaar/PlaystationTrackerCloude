-- Контрольные значения для миграции 0016 (Фаза 21, контракт 23.2). Только чтение.
-- Запустить ДО docs/release-neon-0016.sql и ПОСЛЕ него: строки users_* совпадают, zz_tour_columns меняется 0 -> 2. Отметку существующих пользователей (tour_version = 1) проверяет флаг existing_users_marked в конце release-neon-0016.sql.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'users_onboarded', count(*) FROM allowed_users WHERE onboarded_at IS NOT NULL
UNION ALL SELECT 'users_owner', count(*) FROM allowed_users WHERE role = 'owner'
UNION ALL SELECT 'zz_tour_columns', count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name IN ('tour_version', 'tour_completed_at')
ORDER BY 1;
