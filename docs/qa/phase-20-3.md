# QA: Фаза 20.3 (backend на userId), приёмка

Ветка `claude/determined-dijkstra-d3j9g3`, коммит `362f982`. Дата: 2026-10-31. Прод: миграция `0014` применена, `0015` нет.

## Вердикт: принято с замечаниями

Блокеров нет. Утечек данных между пользователями в коде не найдено: все SELECT/UPDATE/DELETE по 19 таблицам идут с `user_id`, INSERT/upsert пишут `userId`, `ON CONFLICT` целится в индексы, которые существуют после `0014`. Для выкладки код безопасен на схеме после `0014`.
Условия: до 0015 закрыть B-1 (recommend_reasons), до закрытия фазы 20 довести e2e (B-2) и охранные тесты (B-3, тесты добавлены).

## Что проверено и результат

| Пункт | Результат |
|---|---|
| 1. Фильтры по `user_id` | Прочитаны построчно все модули `src/server` и роуты `src/app/api`, трогающие 19 таблиц (collection, stats, wrapped, roadmap, recommend, sync, backup, notify, health). Пропусков нет. JOIN с второй таблицей несут `user_id` (`eq(x.userId, userId)` в условии join); где его нет, это связь по глобальному `id` (см. N-1). Raw `sql`` (activity, status totals, linkByConcept, advisory-локи) содержат `user_id` или ключ `…:${userId}`. TRUNCATE и DELETE без where в коде нет (TRUNCATE только в тест-хелпере). Reset-all, restore, экспорт, bulk работают по `userId`. |
| 2. Роуты | 45 `route.ts`: все, кроме login, logout, google, google/callback и cron/*, под `requireUser`/`requireOwner`. `userId` берётся только из `a.user.id`; в теле, query и path его нет. Чужой `{id}` даёт 404 (`user-isolation.test`, проходит). |
| 3. Cron/sync | `?continue=` берёт пользователя из `sync_runs.user_id` (`getRunUserId`), параметры только `continue` и `hop`. Watchdog и недельная копия идут по owner. Без owner: `/api/cron/sync` отвечает 500 `config_error`, watchdog 200 с `alert:'error'` (см. N-2). |
| 4. Совместимость с продом между 0014 и 0015 | Новый тест `src/server/post-0014-compat.test.ts` (PGlite, схема ровно после `0014`, owner id=1, старые unique и `default 1` на месте): синк fixture дважды (идемпотентен, `user_id=1`, профиль без `id`), смена статуса и `completed_at`, reset-all и откат, настройки плана (повторный upsert при PK `id=1`), planned, порядок, исключение, «Подскажи», дизлайки, счётчик LLM (upsert по `(user_id, day)` при старом PK `day`), статистика, Итоги, экспорт, предпросмотр и двойное восстановление. Все 7 тестов зелёные, ни один INSERT не упал на PK/unique старой схемы. Откат кода на старую версию до 0015 безопасен: новые колонки `default 1`, старые ключи на месте. |
| 5. Регрессия | `vitest run`: 147 файлов, 2647 тестов зелёные (до моих добавлений). С добавленными: ещё 2 файла, 10 тестов, зелёные. `tsc --noEmit` и `eslint .` чисты. e2e: см. B-2. |
| 6. Охранные тесты | См. ниже, B-3. |
| 7. Риски выкладки | См. ниже. |

## Мутационная проверка (вручную, всё откачено `git checkout`)

Убирал `eq(userId)` в одной функции за раз и гонял `user-scope.test`, `user-isolation.test`, `blocked.test`.

| Мутация | Охранные тесты | После добавления `user-isolation-diff.test` |
|---|---|---|
| `deletePlanned` без userId | упал | упал |
| `setGameHidden` без userId | упал | упал |
| `getMonthExclusions` без userId | **прошёл** | упал |
| `getActivity` (raw SQL, `where p.user_id`) без userId | **прошёл** | упал |
| `getStats` (`inYear` снимки) без userId | **прошёл** | упал |
| `getStats`/`getWrapped` completed/dropped без userId | прошёл | прошёл (эквивалентно: чужие id отсекаются `gameById`) |
| `getDislikedIds` без userId | прошёл | прошёл (эквивалентно: id игр глобальны) |
| rare / trophies-by-game / snapshots base без userId | прошёл | прошёл (эквивалентно: сузит другой фильтр в том же запросе) |

`user-scope.test.ts` (статический скан) ловит только файл, где `userId` нет вообще; пропуск в одной из десяти функций файла он не видит. `blocked.test.ts` рабочий (без cookie даёт 401 на всех методах всех роутов, БД мокирована падением). `user-isolation.test.ts` ловит утечку маркеров в тексте и «чужой id»; утечку чисел (часы, счётчики) без названий не ловит.

## Дефекты

### B-1 (major, до 0015): `ON CONFLICT` кэша фраз не совпадёт с целевым PK
`src/server/recommend/db.ts:103` (`writeCachedReasons`): `target: [recommendReasons.gameId, recommendReasons.signalsHash]`. Сейчас это PK `(game_id, signals_hash)` и работает. По `docs/api-contract.md` 22.1 после `0015` PK `recommend_reasons` становится `(user_id, game_id, signals_hash)`; миграция 0014 для этой таблицы unique с `user_id` не добавляла (в отличие от пяти таблиц из 22.11). Если `0015` заменит PK, запись фраз упадёт с «no unique or exclusion constraint matching the ON CONFLICT specification»; ошибка проглатывается шагом LLM синка (предупреждение), фразы молча перестанут кэшироваться.
Воспроизведение: после `0015` выполнить синк с `LLM_API_KEY` и включённым шагом фраз, проверить `recommend_reasons` (пусто).
Исправление: в `0015` оставить unique `(game_id, signals_hash)` либо перейти на target `[userId, gameId, signalsHash]` вместе с миграцией. Тест на это нужно добавить в `release-sql-0015`.
Текущая выкладка не затронута.

### B-2 (major): e2e красный на 3 тестах (деградация от `requireUser`)
`e2e/collection-api.spec.ts:31`, `e2e/collection-api.spec.ts:60`, `e2e/sync.spec.ts:41`. Тесты «API без БД» проверяют валидацию (400) с подписанной cookie, но без БД. Теперь `requireUser` читает пользователя из БД до валидации, БД в e2e недоступна, ответ 503 вместо 400. Поведение сервера корректное (сначала аутентификация), тесты устарели.
Воспроизведение: `PW_CHROMIUM_PATH=… npx playwright test e2e/collection-api.spec.ts e2e/sync.spec.ts --project=desktop`: 3 failed, 47 passed.
Исправление: e2e с реальной валидацией нужна БД с owner (PGlite нельзя, это dev-сервер) либо тестовая подмена `requireUser` по env только в `NODE_ENV=test`; вне зоны QA (код продукта). Валидацию 400 по существу покрывают vitest-тесты роутов с `requireUserMock`.
Ещё один тест (`e2e/recommend.spec.ts:141`, окно игры) упал в полном прогоне и прошёл при повторе (флак под нагрузкой).

### B-3 (major, закрыто тестами QA): охранные тесты пропускали утечки чисел
Мутации `getMonthExclusions`, `getActivity`, `getStats` (снимки года) без `user_id` проходили все три охранных теста. Добавлен `src/server/user-isolation-diff.test.ts`: вывод 14 читающих функций пользователя в БД с чужими данными должен совпадать побайтово с выводом в БД без них (для A и для B; id выровнены порядком засева). Все три мутации теперь роняют тест. Оставшиеся выжившие мутации эквивалентны (см. таблицу). Рекомендация: оставить тест в наборе.

### N-1 (minor): подзапросы видимости без `user_id`
`src/server/collection/visibility.ts:5-11` (`gameVisible`, `trophySetCounted`): подзапрос `select id from games where hidden_at is null` и агрегат по `game_trophy_sets join games` без `user_id`. Корректность не страдает (`games.id` и `trophy_sets.id` глобальные, внешний запрос отфильтрован по пользователю), но каждый запрос сканирует игры всех пользователей, а при будущей смене id на per-user сломается молча. Улучшение: добавить `user_id` в подзапросы.

### N-2 (minor): неверное сообщение при отсутствии owner / у member без ника
`src/server/sync/service.ts` (`launchSync`): нет owner в `allowed_users` или нет ника у member даёт `config_error`, API отвечает 500 «Не заданы настройки PSN». Для member без ника уместнее 4xx с понятным текстом (онбординг в 20.4). `cron/watchdog` без owner отвечает 200 с `alert:'error'` (без алерта в Telegram).

### N-3 (minor): документация
`src/server/auth/session.ts:74` говорит «поддержка v:1 удаляется в 20.3», `docs/api-contract.md` 22.12 и `plan.md`: после `0015`. Привести к одному.

## Риски выкладки (прод между 0014 и 0015)

1. Порядок: `0014` уже применена, затем деплой кода 20.3. Код ожидает owner с `id=1` (`v:1` cookie трактуется как uid=1) и unique-индексы `*_user_*_key` из `0014` (проверено: `ON CONFLICT` целится только в них или в сохранённые PK). Перед деплоем выполнить в Neon: `select id, role, status from allowed_users;` (нужен owner `id=1`, `status='active'`) и `select indexname from pg_indexes where indexname in ('games_user_title_id_key','trophy_sets_user_np_key','trophies_user_set_trophy_key','playtime_snapshots_user_game_date_key','psn_profile_user_key','roadmap_settings_user_key','recommend_llm_usage_user_day_key','recommend_discover_cache_user_day_key','recommend_external_dislikes_user_key');` (девять строк). Если owner не `active`, `requireUser` вернёт 401 всем, включая аварийный вход.
2. После деплоя первый ручной синк owner: проверить, что `games`/`playtime_snapshots` не дублируются (счётчики `release-neon-0014-check.sql` до и после), `sync_runs.user_id=1`.
3. Cookie: действующие `v:1` продолжают работать как owner, дополнительный запрос к БД на каждый API-вызов (`requireUser`); при недоступной БД все `/api/*` дают 503 (раньше часть эндпоинтов валидировала без БД).
4. `/api/health` теперь требует сессию: внешний мониторинг без cookie получит 401 (в `proxy.ts` это было и раньше; проверьте, нет ли пингера).
5. Откат: пока `0015` не применена, откат кода на предыдущий деплой безопасен (новые колонки `default 1`, старые ключи и `id default 1` на месте, старый код пишет `user_id=1`). После `0015` откат кода невозможен без обратной миграции.
6. Второго пользователя до `0015` на проде создавать нельзя: вторая игра с тем же `title_id`, второй `psn_profile`/`roadmap_settings` упадут на старых ключах (задокументировано в 22.12). Владельцу не раздавать приглашения до `0015`.
7. Бэкап: перед деплоем «Скачать копию» (формат не менялся).

## Что не удалось проверить
- Полный e2e: прогон остановлен по времени на ~793 из 1616 (desktop частично, mobile не запускался); отдельно перезапущены 3 файла на desktop (результат B-2). Остальное не проверено.
- Реальный Neon: миграция и деплой не выполнялись, `0015` не существует, проверена только эмуляция на PGlite.
- Реальный PSN/Google/Telegram/RAWG/Groq: только фикстуры и моки.
- Нагрузка: параллельные синки двух пользователей, глобальный «один running» (B получает 409 при идущем синке A) проверен на логике, не под нагрузкой.
- Поведение `?continue=` для заблокированного пользователя: проверки `status` в `launchSync` нет, продолжение запуска blocked-пользователя возможно (в 20.3 других пользователей в синке нет, в 20.4 учесть).

## Добавленные тесты
- `src/server/post-0014-compat.test.ts` (7): сценарии на схеме ровно после `0014`.
- `src/server/user-isolation-diff.test.ts` (3): дифференциальная изоляция.
