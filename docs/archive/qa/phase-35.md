# Приёмка QA, Фаза 35 «Здоровье» (owner)

Ветка claude/phase-35-health. Вердикт: **принято с замечаниями** (блокеров нет).

## Прогон
- `tsc --noEmit`: чисто. `eslint .`: 0 ошибок, 4 предупреждения (старые, в `nightly-chain-profiles.test.ts`, к фазе не относятся).
- `vitest run`: 249 файлов, 3753 теста зелёные (до добавления QA-теста). Новый `src/ui/health/labels-schema.test.ts`: 7 проверок, из них 1 `it.fails` (QA-35-1).
- e2e (desktop + mobile): `phase35-health` и `phase20-access`, 42 из 42 зелёные.

## Чек-лист
1. Owner-only. `requireOwner` читает роль из БД; в route.test проверены 401, 403 для member и для доп. профиля member-входа (тело без данных), 200 для owner. Секреты (NPSSO, CRON_SECRET, LLM/RAWG ключи), `google_sub`, `psn_account_id`, `error_message`, архивные профили в теле отсутствуют. Email у доп. профилей `null`. `Cache-Control: no-store`. SW не кэширует `/api/*`. Страница не содержит данных (всё через API), member видит 404. OK.
2. Критерии и потолки. `disabled` даёт `limit: null` и текст «Запросы не выполняются», не безлимит. `RAWG_USER_DAILY_LIMIT=0` даёт 1 и `clamped`, `99999` даёт 1000 и `clamped`, `LLM_DAILY_LIMIT=500` даёт 200 и `clamped`, мусор даёт `default`, нули в total дают `limit_zero`. Логика совпадает с `getProviderLimits`/`getLlmEnv`. Критерии соответствуют таблице контракта. OK.
3. UI. 320 и 412 px без горизонтального скролла, 7 тем (night, graphite, ps1..ps5) читаемы, состояния loading, error с «Повторить», 403 как 404. OK по e2e.
4. Сверка kind. Реальные значения `sync_run_kind`: `daily | manual | trophy_backfill | hltb`. В `runKindLabel` есть `onboarding`, `initial`, `trophies` (в схеме и коде синка их нет), а `trophy_backfill` нет. Коды `error_reason` совпадают (кроме `cancelled`, он отфильтрован). См. QA-35-1.

## Замечания
- **QA-35-1 (низкая, продукт, frontend).** `src/ui/health/model.ts`, `RUN_KIND`: нет подписи для `trophy_backfill` (в списке ошибок покажется сырой `trophy_backfill`), три подписи мёртвые. Шаги: создать `sync_runs` с `kind='trophy_backfill', status='failed'` в окне 14 суток, открыть /health под owner. Исправление: заменить ключи на `daily, manual, trophy_backfill`. Тест `it.fails` в `labels-schema.test.ts` станет красным после правки, тогда заменить на `it`.
- **QA-35-2 (низкая, продукт, backend).** `describeLlm`: при отсутствии и провайдера, и ключа возвращает `no_provider`, контракт описывает `no_key` для случая «ключа нет». Неоднозначность формулировок, согласовать контракт или код.
- **QA-35-3 (информационная).** `psnToken.lastEvent.details` отдаётся как есть. Сейчас там только числа и причины (контракт 27.3), но защиты от будущих полей нет.
- **QA-35-4 (информационная).** `observation_sync` и `owner_ready` не имеют e2e/интеграционного теста на данные в PGlite с `MULTIUSER_ENABLED=1` (покрыто чистой логикой в `health.test.ts`).

## Не проверено
- Реальная БД Neon и реальная сессия (роут тестировался с моком `requireUser` на PGlite, e2e с моком API).
- Визуальное сравнение скриншотов на 320 px: три колонки расхода в карточке профиля (`repeat(3, minmax(0,1fr))`) при длинном «N · выключено» проверены только на отсутствие горизонтального скролла, не на обрезание текста.
- Длинные email/ники на 320 px (CSS использует `overflow-wrap: anywhere`, глазами не проверено).
- Контраст бейджей уровней (ok/warn/danger) в каждой теме не измерялся.
