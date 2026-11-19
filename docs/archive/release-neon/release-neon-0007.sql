-- Миграция 0007 для Neon SQL Editor. Фаза 11, контракт 16.7. Идемпотентно, только добавляет значение enum.
-- Применять ДО деплоя кода массовой подгрузки HLTB.
-- ADD VALUE выполняйте отдельным запуском (не в одной транзакции с использованием значения).

ALTER TYPE "public"."sync_run_kind" ADD VALUE IF NOT EXISTS 'hltb';

-- Журнал drizzle (хеш = sha256 файла миграции, created_at = when из _journal.json)
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
	('007518fa6ddd5d379630b5a766788fb8c1b84282ead6dd2342dc54b7097bd688', 1793218001382::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: hltb_in_enum = true.
SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'sync_run_kind' AND e.enumlabel = 'hltb') AS hltb_in_enum;
