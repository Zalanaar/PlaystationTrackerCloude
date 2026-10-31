-- Аналог `npm run db:bootstrap-owner` для Neon SQL Editor (без терминала). Фаза 20.2, контракт 22.7 шаг 2.
-- ПЕРЕД запуском замените ВАШ_EMAIL@gmail.com на email владельца (строчными буквами, как в OWNER_EMAIL в Vercel)
-- и ВАШ_ONLINE_ID на onlineId PSN (то же, что PSN_TARGET_ONLINE_ID). НЕ коммитьте файл с подставленным email.
-- Применять ПОСЛЕ docs/release-neon-0013.sql. Идемпотентно: если owner уже есть, ничего не меняет.
-- Ожидание: owner_id = 1. Иначе деплой и миграцию 0014 НЕ делать, написать оркестратору.

INSERT INTO allowed_users (email, role, status, psn_online_id, psn_access_status)
SELECT 'ВАШ_EMAIL@gmail.com', 'owner', 'active', 'ВАШ_ONLINE_ID', 'ok'
WHERE NOT EXISTS (SELECT 1 FROM allowed_users WHERE role = 'owner');

-- Проверка: owner_id = 1, role = owner, status = active.
SELECT id AS owner_id, role, status, psn_online_id FROM allowed_users WHERE role = 'owner';
