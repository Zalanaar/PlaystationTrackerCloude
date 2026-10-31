-- Контрольные значения для миграции 0017 (хвост 20.5, контракт 24). Только чтение.
-- Запустить ДО docs/release-neon-0017.sql и ПОСЛЕ него: строки данных совпадают, zz_provider_usage_table меняется 0 -> 1.
SELECT 'users_total' AS t, count(*) AS n FROM allowed_users
UNION ALL SELECT 'games_total', count(*) FROM games
UNION ALL SELECT 'llm_usage_rows', count(*) FROM recommend_llm_usage
UNION ALL SELECT 'zz_provider_usage_table', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'provider_usage'
ORDER BY 1;
