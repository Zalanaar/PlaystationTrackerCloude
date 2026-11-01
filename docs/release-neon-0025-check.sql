-- Контрольные значения для миграции 0025 (Фаза 41, контракт 41.5). Только чтение.
-- Запустить ДО docs/release-neon-0025.sql и ПОСЛЕ него: строки данных совпадают (прод: 3 пользователя, 1237 игр),
-- строки zz_* меняются (колонка/индексы появляются). Строки bad_* обязаны быть 0 всегда.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'trophies_total', count(*) FROM trophies
UNION ALL SELECT 'playtime_snapshots_total', count(*) FROM playtime_snapshots
UNION ALL SELECT 'game_status_rows', count(*) FROM game_status
UNION ALL SELECT 'bad_duplicate_psn_account', count(*) FROM (SELECT 1 FROM allowed_users WHERE psn_account_id IS NOT NULL AND status <> 'archived' GROUP BY psn_account_id HAVING count(*) > 1) d
UNION ALL SELECT 'bad_duplicate_psn_online_id', count(*) FROM (SELECT 1 FROM allowed_users WHERE psn_online_id IS NOT NULL AND status <> 'archived' GROUP BY lower(psn_online_id) HAVING count(*) > 1) d
UNION ALL SELECT 'bad_owner_not_id_1', count(*) FROM allowed_users WHERE role = 'owner' AND id <> 1
UNION ALL SELECT 'zz_primary_user_id_column', count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'primary_user_id'
UNION ALL SELECT 'zz_profile_indexes', count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('allowed_users_email_primary_key', 'allowed_users_psn_account_key', 'allowed_users_psn_online_key', 'allowed_users_primary_idx')
ORDER BY 1;

-- Только ПОСЛЕ миграции (до неё колонки нет, запрос упадёт; это нормально): дополнительные профили и вложенность.
-- Ожидание сразу после миграции: extra_profiles = 0, nested_profiles = 0.
-- SELECT
--   (SELECT count(*) FROM allowed_users WHERE primary_user_id IS NOT NULL) AS extra_profiles,
--   (SELECT count(*) FROM allowed_users p JOIN allowed_users c ON c.id = p.primary_user_id WHERE c.primary_user_id IS NOT NULL) AS nested_profiles;
