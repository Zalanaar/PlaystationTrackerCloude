# API-контракт PS Tracker

Версия: 1.2 (Фаза 1; раздел 8 «Синк» добавлен в Фазе 2; раздел 9 «Коллекция» в Фазе 3; раздел 10 «Статистика» в Фазе 5; Фаза 8: скрытие игр, сброс/откат статусов, «Игры месяца», конец оценки часов по первому снимку; раздел 14 «Доп. предложения» в Фазе 15; раздел 15 «Этап 2: backend-блок» дополняет разделы 1, 5, 9, 12, 14; раздел 16 «Бэклог: фильтры и длительность» в Фазе 11; раздел 17 «Роадмап бэклога на год» в Фазе 12, дополняет разделы 4.2 и 5). Статус: черновик на согласование с оркестратором. Код (`src/db/schema.ts`, auth, middleware) пишется строго по этому документу. Любое отклонение сначала правится здесь.

Источник фактов о PSN: `docs/api-notes.md` (результаты Фазы 0).

## 0. Общие соглашения
- БД: Postgres (Neon), Drizzle ORM, схема в `src/db/schema.ts`.
- Все моменты времени: `timestamptz` (хранится UTC). Календарные даты (`date`) всегда по Europe/Moscow, это явно указано в колонке.
- Имена: таблицы и колонки в `snake_case`, во множественном числе для таблиц (кроме `game_status`, `psn_auth`).
- Первичные ключи: `integer generated always as identity` (в Drizzle `integer().primaryKey().generatedAlwaysAsIdentity()`), если не сказано иное.
- Идентификаторы PSN хранятся как `text` (не числа): `title_id`, `concept_id`, `np_communication_id`.
- Длительности: в секундах, `integer` (PSN отдаёт ISO 8601 `PT228H56M33S`, парсится в `src/server/psn/`). Максимум int32 даёт 68 лет, хватает.
- Фильтр «не игры»: в `games` попадают только `category` из `ps4_game`, `ps5_native_game`, `pspc_game`. Остальное (медиа-приложения, мини-аппы) отбрасывается на маппинге и не хранится.
- Ничего не удаляется синком. Игра, пропавшая из ответа PSN, остаётся в БД (обновляется `last_seen_at` только у тех, кто пришёл). Ошибка PSN не меняет данные.

## 1. Схема БД

### 1.1 Перечисления (pgEnum)
| Имя | Значения |
|---|---|
| `game_status_value` | `playing`, `completed`, `dropped`, `backlog`, `shelved`, `service` («игра-сервис»: пройти нельзя, к ней возвращаются; даты завершения не имеет) |
| `trophy_type` | `bronze`, `silver`, `gold`, `platinum` |
| `trophy_set_link_source` | `title_id`, `concept`, `name`, `manual` |
| `sync_run_kind` | `daily` (cron), `manual` (кнопка/ручной запуск), `trophy_backfill` (дозагрузка трофеев), `hltb` (массовая подгрузка длительности, 16.7; в индикации синка не участвует) |
| `sync_run_status` | `running`, `success`, `partial`, `failed` |
| `sync_error_reason` | `auth_expired`, `npsso_invalid`, `access_denied`, `rate_limited`, `psn_unavailable`, `timeout`, `internal` |

«Без статуса» это отсутствие строки в `game_status`. Значения `none` в enum нет.

### 1.2 `games`
Одна строка на PSN `titleId` (CUSA/PPSA/PCSA...). Разные платформенные версии одной игры это разные строки; общий `concept_id` позволяет их объединять в UI при необходимости.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `title_id` | text | нет | PSN `titleId`. **UNIQUE** |
| `concept_id` | text | да | `concept.id`; общий для версий одной игры |
| `name` | text | нет | `name` из PSN (приоритет `localizedName`, если есть, иначе `name`) |
| `category` | text | нет | `ps4_game` / `ps5_native_game` / `pspc_game`. CHECK на три значения |
| `image_url` | text | да | `imageUrl`, иначе `localizedImageUrl`, иначе первая из `concept.media.images` |
| `psn_genres` | text[] | нет, default `'{}'` | сырые значения `concept.genres` как отдал PSN (английские, в верхнем регистре, без нормализации). Порядок сохраняется |
| `genres_override` | text[] | да | **заготовка** под ручную правку жанров. NULL = не переопределено. В MVP не заполняется и в UI не редактируется. Хранит уже нормализованные ключи (см. 1.9) |
| `play_duration_seconds` | integer | нет, default 0 | суммарное время из `playDuration` |
| `play_count` | integer | нет, default 0 | |
| `first_played_at` | timestamptz | да | `firstPlayedDateTime` |
| `last_played_at` | timestamptz | да | `lastPlayedDateTime` |
| `trophy_checked_at` | timestamptz | да | когда последний раз искали трофейные сеты для этой игры. NULL = ещё не искали |
| `first_seen_at` | timestamptz | нет, default now() | когда игра впервые попала в БД |
| `last_seen_at` | timestamptz | нет | когда последний раз пришла из PSN |
| `hidden_at` | timestamptz | да | Фаза 8. Мягкое скрытие («удалить из коллекции»): не NULL = игра скрыта с этого момента. Пишет только `PUT /api/games/{id}/hidden` (9.7); синк колонку не трогает. Что исключается для скрытых: 9.10 |
| `created_at` / `updated_at` | timestamptz | нет, default now() | `updated_at` обновляется приложением при апсёрте |

Индексы: UNIQUE `games_title_id_key (title_id)`; `games_concept_id_idx (concept_id)`; `games_last_played_at_idx (last_played_at desc nulls last)`; GIN `games_psn_genres_gin (psn_genres)` не нужен для MVP (жанры агрегируются в коде).

Upsert синка: `INSERT ... ON CONFLICT (title_id) DO UPDATE` по всем PSN-полям. Поля `genres_override`, `hidden_at` и всё из других таблиц не затрагиваются (скрытая игра остаётся скрытой после синка, её снимки и трофеи продолжают писаться). Если PSN отдал `play_duration_seconds` меньше сохранённого, сохраняется значение из PSN (PSN авторитетен), но это логируется как предупреждение в `sync_runs.warnings` (см. 1.7).

### 1.3 `game_status`
Ручной статус игры. Отдельная таблица, чтобы синк никогда не мог перетереть ручные данные.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `game_id` | integer PK, FK -> `games.id` ON DELETE CASCADE | нет | связь 1:1 |
| `status` | `game_status_value` | нет | |
| `completed_at` | timestamptz | да | заполнено только при `status = 'completed'` |
| `dropped_at` | timestamptz | да | заполнено только при `status = 'dropped'` |
| `status_changed_at` | timestamptz | нет, default now() | когда статус менялся последний раз |
| `created_at` / `updated_at` | timestamptz | нет, default now() | |

CHECK-ограничения:
- `completed_at IS NULL OR status = 'completed'`
- `dropped_at IS NULL OR status = 'dropped'`

Правила (реализуются в `src/server/sync/` или сервисе статусов, не в триггерах):
1. Нет строки = «без статуса». Сброс в «без статуса» = `DELETE` строки.
2. Смена на `completed`: `completed_at = games.last_played_at`; если `last_played_at` NULL, то `now()`. Аналогично `dropped` -> `dropped_at`.
3. Смена с `completed`/`dropped` на другой статус: соответствующая дата обнуляется.
   `service` ведёт себя как `playing`/`backlog`/`shelved`: даты не ставятся, при смене на `service` обе даты обнуляются; ручная правка даты для `service` запрещена (правило 5, `409 status_conflict`). `service` не входит в «пройдено/брошено» Статистики и Итогов (они считают только `completed`/`dropped`), часы `service`-игр учитываются как обычно (по снимкам).
4. Повторная установка того же статуса не трогает даты.
5. Ручная правка `completed_at`/`dropped_at` допустима только пока статус соответствует; меняет только эту колонку и `updated_at`.
6. Синк никогда не пишет в `game_status`. Исключение: нет. Автосмены статусов в MVP нет.

Индекс: `game_status_status_idx (status)`; `game_status_completed_at_idx (completed_at) WHERE completed_at IS NOT NULL`; `game_status_dropped_at_idx (dropped_at) WHERE dropped_at IS NOT NULL` (партиальные индексы для статистики по месяцам).

### 1.4 `trophy_sets` и `game_trophy_sets` (связь многие-ко-многим)
Трофейный сет (`npCommunicationId`) и игра (`titleId`) связаны через промежуточную таблицу. Факты из api-notes: у 6 игр несколько сетов, у 49 игр сета нет, 1 сет сиротский (без игры).

`trophy_sets`:

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `np_communication_id` | text | нет | `NPWR...`. **UNIQUE** |
| `np_service_name` | text | нет | `trophy` или `trophy2` (нужен для запросов) |
| `name` | text | нет | `trophyTitleName` |
| `platform` | text | да | `trophyTitlePlatform` как есть |
| `icon_url` | text | да | |
| `defined_bronze` / `defined_silver` / `defined_gold` / `defined_platinum` | integer | нет, default 0 | `definedTrophies` |
| `earned_bronze` / `earned_silver` / `earned_gold` / `earned_platinum` | integer | нет, default 0 | `earnedTrophies` (кэш из `getUserTitles`; источник истины для периодов, это таблица `trophies`) |
| `progress` | smallint | нет, default 0 | 0..100. CHECK |
| `last_updated_at` | timestamptz | да | `lastUpdatedDateTime` из PSN |
| `trophies_synced_at` | timestamptz | да | когда успешно загружен полный список трофеев. NULL = детали не загружены |
| `created_at` / `updated_at` | timestamptz | нет | |

Индексы: UNIQUE `trophy_sets_np_communication_id_key`.

`game_trophy_sets`:

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `game_id` | integer FK -> `games.id` ON DELETE CASCADE | нет | |
| `trophy_set_id` | integer FK -> `trophy_sets.id` ON DELETE CASCADE | нет | |
| `source` | `trophy_set_link_source` | нет | как найдена связь (алгоритм из api-notes: `title_id` -> `concept` -> `name`; `manual` для ручной правки) |
| `created_at` | timestamptz | нет, default now() | |

PK составной `(game_id, trophy_set_id)`. Индекс `game_trophy_sets_trophy_set_id_idx (trophy_set_id)`.

Семантика:
- Игра без сета: нет строк в `game_trophy_sets`. Признак «проверяли, не нашли»: `games.trophy_checked_at IS NOT NULL` и нет связей. UI показывает «нет данных».
- Игры без сетов перепроверяются при каждом полном синке (раз в N дней, решает sync; в MVP: если `trophy_checked_at` старше 7 дней).
- Сет без игры (сирота) хранится, трофеи учитываются в статистике по `earned_at`, но к конкретной игре не привязаны.
- Повторный синк идемпотентен: связи вставляются `ON CONFLICT (game_id, trophy_set_id) DO NOTHING`. Источник `manual` не перезаписывается автоматическими источниками. Автосвязи сами не удаляются.
- Если игра имеет несколько сетов, её прогресс считается суммой по сетам (правило для `stats`).

### 1.5 `trophies`
Одна строка на трофей сета. Хранит и определение трофея, и факт получения (аккаунт один).

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `trophy_set_id` | integer FK -> `trophy_sets.id` ON DELETE CASCADE | нет | |
| `trophy_id` | integer | нет | `trophyId` внутри сета (0 обычно платина) |
| `type` | `trophy_type` | нет | |
| `name` | text | да | NULL для скрытых, пока не получены |
| `detail` | text | да | |
| `icon_url` | text | да | |
| `hidden` | boolean | нет, default false | `trophyHidden` |
| `earned` | boolean | нет, default false | |
| `earned_at` | timestamptz | да | `earnedDateTime`. CHECK: `earned = true` => допускается NULL (PSN иногда не отдаёт дату), `earned = false` => `earned_at IS NULL` |
| `rarity` | smallint | да | `trophyRare` (0..3) |
| `earned_rate` | numeric(5,2) | да | `trophyEarnedRate`, % |
| `created_at` / `updated_at` | timestamptz | нет | |

Ограничения и индексы:
- UNIQUE `trophies_set_trophy_key (trophy_set_id, trophy_id)` для идемпотентного апсёрта.
- `trophies_earned_at_idx (earned_at) WHERE earned_at IS NOT NULL` для статистики по периодам.
- `trophies_set_earned_idx (trophy_set_id, earned)`.

Правила:
- Апсёрт `ON CONFLICT (trophy_set_id, trophy_id) DO UPDATE`. Признак `earned = true` и `earned_at` обратно в false/NULL **не откатываются** (защита от неполного ответа PSN): обновление `earned`/`earned_at` только если пришло `earned = true`. Если PSN реально забрал трофей (бывает крайне редко), это игнорируем.
- Трофеи за период = `COUNT(*) WHERE earned_at >= :from AND earned_at < :to`, границы периода это полночи Europe/Moscow, переведённые в UTC.
- Загрузка деталей трофеев батчами по сетам; сет считается загруженным после успеха всех его страниц (`trophies_synced_at`). Сет перезагружается, если `trophy_sets.last_updated_at` > `trophies_synced_at` или счётчики `earned_*` в `getUserTitles` изменились.

### 1.6 `playtime_snapshots`
Ежедневный снимок суммарного времени игры. Единственный источник часов за период.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `game_id` | integer FK -> `games.id` ON DELETE CASCADE | нет | |
| `snapshot_date` | date | нет | календарная дата **по Europe/Moscow** |
| `play_duration_seconds` | integer | нет | суммарное время на момент снимка |
| `play_count` | integer | нет, default 0 | |
| `last_played_at` | timestamptz | да | |
| `captured_at` | timestamptz | нет, default now() | реальный момент снимка |
| `sync_run_id` | integer FK -> `sync_runs.id` ON DELETE SET NULL | да | |

UNIQUE `playtime_snapshots_game_date_key (game_id, snapshot_date)`. Индекс `playtime_snapshots_date_idx (snapshot_date)`.

**Решение про границу дня: Europe/Moscow.** Обоснование: весь UI и статистика (месяц, год, Wrapped) показываются по Москве; граница месяца в Москве не совпадает с UTC на 3 часа, и по UTC часы игры в 01:00 МСК 1 числа ушли бы в прошлый месяц. Хранить дату в МСК проще, чем пересчитывать каждый запрос.

Как работает:
- `snapshot_date` для всех снимков одного запуска берётся **один раз из `sync_runs.started_at`** (в МСК), а не из текущего времени батча. Так запуск, растянутый на полночь, не размазывается по двум датам.
- Vercel Cron в UTC: расписание `0 20 * * *` (23:00 МСК). Снимок отражает конец московского дня. На Hobby точность cron в пределах часа, то есть 23:00..23:59 МСК, дата остаётся той же. Расписание `0 20 * * *` фиксируется в `vercel.json` (зона frontend/оркестратора, здесь только контракт).
- Идемпотентность: `INSERT ... ON CONFLICT (game_id, snapshot_date) DO UPDATE` (позднейший запуск того же дня перезаписывает значение, `captured_at` обновляется).
- Снимок пишется для **каждой игры, присутствующей в ответе PSN**, даже если время не изменилось (иначе нельзя отличить «не играл» от «не снимали»). Игры, которых нет в ответе, снимок не получают.
- Ошибка PSN: снимки не пишутся, данные не стираются. Дни без снимков это пропуски; дельта считается между ближайшими снимками.
- Формула часов за период `[from, to]` (даты МСК, включительно) для игры: `S_end - S_base`, где `S_end` = последний снимок с `snapshot_date <= to`, `S_base` = последний снимок с `snapshot_date < from`. Если базового снимка нет (до первого синка истории нет), берётся первый снимок внутри периода, и часы до него не учитываются (дельта от первого снимка). Отрицательные дельты обнуляются. Реализация в `src/server/stats/` с Vitest. Это **реальные** часы; часы до первого снимка игры добавляет оценка (ниже).

**Оценка часов до первого снимка игры (решение Артёма).** Снимков до первого синка нет, но у игры есть `games.first_played_at`, а первый снимок даёт суммарное время и `last_played_at` на дату первого синка. Это время распределяется равномерно по календарным месяцам (МСК), реальные снимки остаются приоритетом. Для каждой игры:
- `D0` = `min(snapshot_date)` игры (дата МСК), `S0` = `play_duration_seconds` в этом снимке. Игра, добавленная после первого синка, имеет свой `D0`.
- Реальные часы после `D0` считаются как раньше (`S_end - S_base`, при отсутствии базы дельта от первого снимка = `S0`). Часы «до D0» это ровно `S0`, поэтому двойного счёта нет: месяц `D0` получает долю оценки плюс реальную дельту после `D0`.
- `L0` = `playtime_snapshots.last_played_at` **первого снимка** игры (того же, что даёт `D0`/`S0`); если там NULL, fallback `games.last_played_at`. Именно `L0`, а не `games.last_played_at`: синк каждый раз перезаписывает `games.last_played_at` текущим значением, и после новой игры диапазон оценки растягивался бы до свежей даты (пример: первый запуск дек 2025, игра в янв 2026, `D0` = 2026-10-27, потом игра в окт 2026: по `games.last_played_at` `S0` делился бы на 11 месяцев вместо 2, декабрь ≈ 0). Исправлено в Фазе 8.
- Оценочная часть равна `S0`, делится поровну **по месяцам** (не по дням) от месяца `first_played_at` до месяца `min(L0, D0)`, оба включительно (МСК). Один месяц: всё в него.
- Оценки нет (только реальные часы), если: `first_played_at IS NULL`; дата `first_played_at` (МСК) позже `D0`; у игры нет снимков; `S0 = 0`.
- `L0 IS NULL` (и в снимке, и в `games`) при заданном `first_played_at`: диапазон из одного месяца `first_played_at`. `L0` раньше `first_played_at` (мусор PSN): тоже один месяц `first_played_at`.
- Округление: доля месяца `floor(S0 / n)` секунд, остаток `S0 mod n` целиком в последний месяц; сумма долей равна `S0` точно.
- Оценка относится только к целым месяцам, поэтому для периода `[from, to]` (месяц или год) она равна сумме долей месяцев внутри периода. Часы игры за период = реальные (формула выше) + оценочные.
- `play_count` в снимках не хранится, по периодам не распределяется и в ответах не участвует.
- Оценка не пишется в БД, считается при каждом запросе из `playtime_snapshots` (первый снимок: `D0`, `S0`, `L0`) и `games` (`first_played_at`, fallback для `L0`). Схема не меняется. Скрытые игры (9.10) в оценку не входят.
- Хранение: ~214 игр x 365 = ~78 тыс. строк в год, объём незначителен; сжатие/очистка не нужны.

### 1.7 `sync_runs`
Каждый запуск синка. Пишется до первого обращения к PSN и закрывается в `finally`.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `kind` | `sync_run_kind` | нет | |
| `status` | `sync_run_status` | нет, default `running` | `partial` = часть батчей выполнена, продолжение будет следующим вызовом |
| `error_reason` | `sync_error_reason` | да | заполняется при `failed` и `partial`. **`auth_expired`**: refresh token PSN протух (живёт ~10 дней, `docs/api-notes.md`) или обмен не удался, нужен новый NPSSO. `npsso_invalid`: переданный NPSSO отвергнут PSN. `access_denied`: цель закрыла список игр/трофеи или перестала быть другом. `rate_limited`: 429 после исчерпания повторов. `psn_unavailable`: 5xx/сеть. `timeout`: функция близка к лимиту, остаток отложен. `internal`: наша ошибка. `cancelled` (Фаза 32.1, миграция 0023): запуск остановлен пользователем (8.8), статус `failed`, не ошибка |
| `error_message` | text | да | краткое описание без токенов, NPSSO, заголовков (макс. 500 символов, санитизируется) |
| `snapshot_date` | date | нет | дата МСК, фиксируется при старте (см. 1.6) |
| `started_at` | timestamptz | нет, default now() | |
| `finished_at` | timestamptz | да | |
| `phase` | text | да | текущий/последний этап: `auth`, `games`, `trophy_sets`, `trophy_link`, `trophies` |
| `cursor` | jsonb | да | состояние для продолжения батчей (например, `{"trophies":{"nextSetId":123}}`). Без секретов |
| `games_seen` / `games_upserted` / `snapshots_written` / `trophy_sets_synced` / `trophies_upserted` | integer | нет, default 0 | счётчики |
| `warnings` | jsonb | да | массив коротких предупреждений (`{code,message}`), например уменьшение `playDuration` |

Индексы: `sync_runs_started_at_idx (started_at desc)`; партиальный UNIQUE `sync_runs_one_running_idx ON sync_runs ((true)) WHERE status = 'running'` (не больше одного одновременного запуска; если запуск завис, считается «брошенным» через 15 минут и закрывается как `failed`/`timeout` при старте следующего).

Влияние `auth_expired` на систему:
- Синк при `auth_expired` останавливается, пишет `failed` с `error_reason = 'auth_expired'`, **данные не трогает**.
- UI/health показывает «PSN недоступен: нужен новый NPSSO» и дату последнего успешного синка.
- Следующий cron снова попробует; восстановление только после обновления секрета `PSN_NPSSO` (или записи нового NPSSO) в окружении Vercel. Так как смена секретов требует согласия Артёма, процесс обновления описывается оркестратором отдельно.
- Из-за ~10 дней жизни refresh token суточный синк обязан обновлять пару токенов при каждом запуске и сохранять новый refresh token (см. 1.8).
- Определение «последний успешный синк»: последняя строка со `status = 'success'`.

### 1.8 `psn_auth` (одна строка)
Хранит токены PSN между запусками serverless-функций.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | smallint PK | нет | всегда 1, CHECK `id = 1` |
| `refresh_token_enc` | text | нет | refresh token, зашифрован AES-256-GCM ключом `TOKEN_ENCRYPTION_KEY`. Формат `v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>` |
| `refresh_expires_at` | timestamptz | да | расчётный срок жизни refresh token (`now + expires_in`) |
| `access_token_enc` | text | да | опционально, тот же формат; можно не хранить (access живёт ~1 час, при каждом синке обновляется) |
| `access_expires_at` | timestamptz | да | |
| `source` | text | нет | `npsso` (получено обменом NPSSO) или `refresh` |
| `updated_at` | timestamptz | нет | |

Правила: токены никогда не логируются и не отдаются через API. Порядок получения токенов в `src/server/psn/`: 1) если в БД есть refresh token и он не истёк, обмен refresh -> новая пара, сохранить; 2) иначе обмен `PSN_NPSSO` -> пара, сохранить; 3) иначе `auth_expired` (если был refresh) или `npsso_invalid` (если NPSSO отвергнут). Запись пары атомарна (один UPDATE/UPSERT).

### 1.9 Жанры: нормализация и словарь (код, не БД)
- В БД: `games.psn_genres` (сырое), `games.genres_override` (заготовка).
- Эффективные жанры игры: `genres_override ?? normalize(psn_genres)`.
- Нормализация и словарь RU в `src/shared/genres.ts` (чистый модуль, его импортируют и сервер, и `src/ui`): `SIMULATOR` -> `SIMULATION`; `UNIQUE` -> `OTHER`; прочее как есть в нижнем ключе из словаря; неизвестное значение -> `OTHER` (и предупреждение в тестах, не падение). Дубликаты после нормализации схлопываются.
- Пустой массив жанров -> `OTHER`.
- Словарь RU-подписей: константа `GENRE_LABELS_RU: Record<GenreKey, string>` там же. Покрывает 17 известных значений (ACTION, ADVENTURE, ROLE_PLAYING_GAMES, SHOOTER, HORROR, UNIQUE, RACING, SIMULATOR, FIGHTING, ARCADE, MUSIC/RHYTHM, CASUAL, STRATEGY, SIMULATION, PUZZLE, FAMILY, PARTY). Точные ключи `MUSIC/RHYTHM` нормализовать в `MUSIC_RHYTHM`.
- Вес в статистике: игра делится между жанрами по 1/N (N после нормализации и схлопывания).

### 1.10 `login_attempts`
Для защиты от перебора (serverless без общей памяти).

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `ip_hash` | text | нет | HMAC-SHA256(ip, `SESSION_SECRET`) в hex; сырой IP не хранится |
| `attempted_at` | timestamptz | нет, default now() | |
| `success` | boolean | нет | |

Индекс `login_attempts_ip_time_idx (ip_hash, attempted_at desc)`. Записи старше 24 часов удаляются при каждом входе (`DELETE ... WHERE attempted_at < now() - interval '24 hours'`).

### 1.11 Диаграмма связей
```
games 1---1 game_status
games 1---N playtime_snapshots
games N---M trophy_sets   (через game_trophy_sets)
trophy_sets 1---N trophies
sync_runs 1---N playtime_snapshots (nullable)
psn_auth (singleton), login_attempts, status_backups (самостоятельные)
```

### 1.12 `status_backups` (Фаза 8)
Снимки содержимого `game_status` перед массовым сбросом (9.8) и перед откатом (9.9). Только для отката; статистика их не читает.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `created_at` | timestamptz | нет, default now() | |
| `reason` | text | да | `reset_all` (перед сбросом всей коллекции) или `before_restore` (перед откатом) |
| `payload` | jsonb | нет | массив строк `game_status`: `[{"gameId":17,"status":"completed","completedAt":"2026-10-05T18:42:11.000Z","droppedAt":null,"statusChangedAt":"2026-10-06T08:00:00.000Z"}]`. Даты ISO UTC или `null` |

Хранятся последние **10** бэкапов: после вставки нового старые (по `id`) удаляются в той же транзакции. Это ротация служебных копий, а не миграция с потерей данных. FK на `games` нет намеренно: бэкап переживает исчезновение игры, при откате такие строки пропускаются.

Миграция `0002` (Фаза 8) только добавляет: `games.hidden_at` (nullable) и таблицу `status_backups`.

## 2. Идемпотентный синк (требования к схеме)
- Порядок: `auth` -> `games` (страницы по 200) -> `trophy_sets` (`getUserTitles`, до 800) -> `trophy_link` (для новых/непроверенных игр пачки по 5 titleId, пауза 300 мс) -> `trophies` (сеты пачками).
- Все записи через апсерты по ключам выше. Повтор запуска даёт тот же результат.
- Каждый батч в транзакции; курсор в `sync_runs.cursor` обновляется в той же транзакции.
- Запуск вне срока функции: останавливаемся с запасом, пишем `partial` + `error_reason = 'timeout'`, продолжаем с курсора следующим вызовом (механизм продолжения: раздел 8.2).
- Снимки пишутся на фазе `games` в том же батче, что и апсерт игр.

## 3. Auth

### 3.1 Механизм
- Единственный пароль `ADMIN_PASSWORD`, пользователей нет. **Будет заменено в Фазе 20** (несколько пользователей по белому списку, своя коллекция у каждого, `plan.md` Этап 6): новый контракт входа и схемы: раздел 22.
- Сессия: cookie `pst_session`, значение `<payload_b64url>.<signature_b64url>`.
  - `payload` = JSON `{"v":1,"iat":<unix сек>,"exp":<unix сек>}`.
  - `signature` = HMAC-SHA256(`payload_b64url`, `SESSION_SECRET`).
- Атрибуты cookie: `HttpOnly; Secure` (кроме `localhost` в dev); `SameSite=Lax`; `Path=/`; `Max-Age=2592000`.
- **Срок сессии: 30 дней, фиксированный** (без продления; после истечения нужен повторный вход). Обоснование: один пользователь, личное устройство; фиксированный срок проще и безопаснее скользящего.
- Отзыв всех сессий: смена `SESSION_SECRET` (нужно согласие Артёма: смена секретов).
- Проверка подписи и срока в `src/proxy.ts` (Next.js 16: `middleware.ts` переименован в `proxy.ts`, runtime Node.js; код совместим с Edge) через Web Crypto (`crypto.subtle`, HMAC verify). `crypto.subtle.verify` сравнивает подпись за постоянное время; ручное сравнение через `===` запрещено. Реализация в `src/server/auth/session.ts`, без зависимостей от Node-API, чтобы работала и в Edge.

### 3.2 Сравнение пароля
- В route handler `/api/auth/login` (runtime `nodejs`): `sha256(input)` и `sha256(ADMIN_PASSWORD)` -> `crypto.timingSafeEqual` по двум буферам по 32 байта (выравнивает длину, не раскрывает её).
- Пустой или отсутствующий `ADMIN_PASSWORD` или `SESSION_SECRET` (менее 32 символов) -> сервер отвечает `500 config_error`, вход невозможен (fail closed). Значения не логируются.

### 3.3 Защита от перебора
- Лимит по IP (из `x-forwarded-for`, первый адрес; на Vercel заголовку можно доверять): **5 неудачных попыток за 15 минут** -> `429 rate_limited`, заголовок `Retry-After` (секунды до освобождения старейшей попытки в окне).
- Глобальный потолок: **300 неудачных попыток за час на всех** -> `429` (только от массовой ротации IP). Было 20: так любой мог держать вход по паролю закрытым для владельца, поэтому основная защита — лимит по IP.
- При неверном пароле ответ с искусственной задержкой 500 мс.
- Успешный вход не сбрасывает счётчик (запись `success = true`, в лимит не входит).
- Атомарность: проверка лимита и запись попытки идут в одной транзакции под `pg_advisory_xact_lock`. Попытка записывается как неудача (`success = false`) **до** сравнения пароля; при верном пароле запись обновляется до `success = true`. Заблокированный запрос (429) ничего не пишет. Параллельная пачка неверных паролей не может превысить лимит.
- Источник: таблица `login_attempts` (1.10).
- Проверка лимита идёт **до** сравнения пароля, чтобы заблокированный IP не мог ничего проверять.

### 3.4 Proxy (`src/proxy.ts`, бывший middleware)
Matcher: `/api/*` проходит через proxy всегда (расширение в пути не пропускает). Остальные пути, кроме `_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest` (Фаза 18: PWA-манифест должен отдаваться без cookie) и файлов с расширениями статики (иконки `icon.svg`, `apple-icon.png`, `/icons/*.png`, шрифты) пропускаются без проверки; остальные пути идут через proxy. Логика:

| Путь | Правило |
|---|---|
| `/login` | открыт. Если сессия валидна, redirect на `/` |
| `/api/auth/login` | открыт (POST) |
| `/api/auth/logout` | открыт (сессия не требуется), идемпотентен, очищает cookie |
| `/api/cron/*` | открыт для сессии, но требует `Authorization: Bearer <CRON_SECRET>`; сравнение constant-time; иначе `401` JSON. Vercel Cron подставляет этот заголовок сам, когда задан `CRON_SECRET` |
| всё остальное (страницы) | нет валидной cookie -> `302` на `/login?next=<path>` (только относительные пути, начинающиеся с одного `/`, иначе игнорировать `next`) |
| всё остальное под `/api/*` | нет валидной cookie -> `401` JSON `{"ok":false,"error":{"code":"unauthorized",...}}` (без редиректа) |

Дополнительно:
- `/api/health` закрыт обычной сессией (не публичный), чтобы не раскрывать состояние.
- Cookie с неверной подписью или истёкшим сроком = нет сессии; cookie очищается в ответе.
- Все ответы закрытых зон: заголовок `Cache-Control: no-store`.
  Исключение (Фаза 47): тяжёлые GET `/api/games`, `/api/collection/summary`, `/api/stats`, `/api/roadmap`, `/api/wrapped` отвечают `Cache-Control: private, no-cache`, `Vary: Cookie` и слабым `ETag` (sha1 тела конверта). Браузер обязан сверяться на каждый запрос: совпавший `If-None-Match` = `304` без тела; сессия проверяется каждый раз, данные считаются заново. `POST /api/auth/logout` и `/api/auth/logout-all` отдают `Clear-Site-Data: "cache"`. Ошибки и остальные эндпоинты: `no-store`.
- Если `CRON_SECRET` не задан, `/api/cron/*` отвечает `401` всегда (fail closed).
- CSRF: `SameSite=Lax` + POST-эндпоинты принимают только `application/json` и проверяют `Origin`, если заголовок есть (должен совпадать с хостом). Мутации только POST/PUT/PATCH/DELETE.

### 3.5 Эндпоинты

**`POST /api/auth/login`**
- Запрос: `Content-Type: application/json`, тело `{"password": string, "next"?: string}`. `password` 1..256 символов.
- 200: `{"ok":true,"data":{"redirectTo":"/"}}` + `Set-Cookie: pst_session=...`. `redirectTo` = валидный `next` или `/`.
- 400 `invalid_request`: тело не JSON или нет `password`.
- 401 `invalid_credentials`: пароль неверен (одно и то же сообщение независимо от причины).
- 429 `rate_limited`: `Retry-After`; в `error.details` поле `retryAfterSeconds`.
- 500 `config_error`.

Страница `/login` (UI, зона frontend) вызывает этот эндпоинт через fetch и по 200 делает переход на `redirectTo`.

**`POST /api/auth/logout`**
- Запрос: без тела, но `Content-Type: application/json` обязателен; `Origin`, если есть, должен совпадать с хостом, иначе `400 invalid_request` (3.4).
- 200: `{"ok":true,"data":{"revoked":boolean}}` + `Set-Cookie: pst_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`.
- Идемпотентен: без сессии тоже 200.
- Фаза 45: валидная сессия отзывается на сервере (`revoked_sessions`), копия cookie больше не пускает; `revoked: false` = сессии не было или БД недоступна (cookie очищается всё равно).

**`GET /api/cron/sync`** (описание эндпоинта в плане синка; здесь только защита): `Authorization: Bearer <CRON_SECRET>` обязателен.

## 4. Формат ответов API

### 4.1 Конверт
Успех (HTTP 2xx):
```json
{ "ok": true, "data": { } }
```
Ошибка (HTTP 4xx/5xx):
```json
{ "ok": false, "error": { "code": "string", "message": "string", "details": { } } }
```
- `code`: стабильный машинный код в `snake_case` из списка ниже. `message`: короткий текст на русском для показа пользователю, без внутренних деталей. `details`: необязательный объект.
- `Content-Type: application/json; charset=utf-8`.
- Даты в ответах: ISO 8601 строка UTC с `Z` (`2026-10-27T20:00:00.000Z`); календарные даты: `YYYY-MM-DD` (МСК). Форматирование для показа делает UI в Europe/Moscow.
- Неожиданные исключения: `500 internal_error`, стек и SQL наружу не уходят.

### 4.2 Коды ошибок
| HTTP | code | Когда |
|---|---|---|
| 400 | `invalid_request` | невалидный JSON, нарушена валидация |
| 401 | `unauthorized` | нет валидной сессии (API) или неверный `CRON_SECRET` |
| 401 | `invalid_credentials` | неверный пароль |
| 404 | `not_found` | |
| 403 | `forbidden` | роль не позволяет действие (например, member отменяет чужой синк, 8.8) |
| 409 | `duplicate_game` | добавление в Бэклог «не куплено»: игра уже есть в библиотеке или в Плане (Фаза 43, 43.2); в `details` сведения о дубле |
| 409 | `manual_limit` | в Бэклоге уже 200 несклеенных записей «не куплено» (43.2) или в списке «Играл на другой платформе» 300 записей (Фаза 44); всегда `details.limit` |
| 409 | `manual_status_locked` | смена статуса записи «не куплено» (43.2) |
| 409 | `sync_in_progress` | синк уже идёт (`POST /api/sync`), в `details.runId` id идущего запуска |
| 409 | `planned_duplicate` | игра из каталога уже добавлена в планируемые (17.7) |
| 409 | `status_conflict` | дату завершения/броска правят у игры, чей статус не соответствует (9.5) |
| 429 | `rate_limited` | перебор пароля |
| 500 | `config_error` | не заданы или невалидны обязательные env |
| 500 | `internal_error` | прочее |
| 503 | `db_unavailable` | БД недоступна |
| 503 | `catalog_unavailable` | внешний каталог RAWG недоступен или не настроен (17.9) |

### 4.3 `GET /api/health`
Требует сессию. Всегда отвечает быстро, к PSN **не обращается** (только БД).

200 при рабочей БД (даже если последний синк упал):
```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "time": "2026-10-27T20:00:00.000Z",
    "db": { "ok": true },
    "sync": {
      "lastRun": {
        "id": 12,
        "kind": "daily",
        "status": "success",
        "errorReason": null,
        "startedAt": "2026-10-26T20:00:03.000Z",
        "finishedAt": "2026-10-26T20:01:10.000Z",
        "snapshotDate": "2026-10-26"
      },
      "lastSuccessAt": "2026-10-26T20:01:10.000Z",
      "psnAuth": "ok"
    }
  }
}
```
- `sync.lastRun` = последняя запись `sync_runs` (любого статуса) или `null`, если синков не было. `lastSuccessAt` = `finished_at` последнего `success` или `null`.
- `sync.psnAuth`: `ok` | `auth_expired` | `unknown`. `auth_expired`, если последний завершённый запуск (не `running`) упал с `error_reason in ('auth_expired','npsso_invalid')`; `unknown`, если запусков нет; иначе `ok`.
- `data.status`: `ok` если БД ответила; `degraded` если БД ответила, но `psnAuth = auth_expired` или последний запуск `failed`.
- Фаза 32.1: запуск `failed/cancelled` (8.8) не делает `status = degraded`, а при расчёте `psnAuth` отменённые запуски пропускаются.
- 503 `db_unavailable`, если запрос к БД не удался (в этом случае конверт ошибки).

## 5. Переменные окружения
Секреты только на сервере (без префикса `NEXT_PUBLIC_`). В репозитории только `.env.example` без значений. Валидация при старте (`src/server/env.ts`, zod): отсутствие обязательной переменной = `config_error`, значения в логи не попадают.

| Переменная | Обязательна | Где | Описание |
|---|---|---|---|
| `DATABASE_URL` | да | сервер | строка подключения Neon (pooled) для приложения |
| `DATABASE_URL_UNPOOLED` | для миграций | сервер, CI | прямое подключение Neon для `drizzle-kit migrate` |
| `ADMIN_PASSWORD` | да | сервер | пароль входа, не короче 12 символов |
| `SESSION_SECRET` | да | сервер | ключ HMAC для cookie и `ip_hash`, не короче 32 символов случайных (`openssl rand -base64 48`) |
| `CRON_SECRET` | да | сервер | Bearer-секрет для `/api/cron/*`, не короче 32 символов. Vercel подставляет сам |
| `PSN_NPSSO` | да | сервер | NPSSO технического аккаунта (64 символа). Используется только когда нет рабочего refresh token |
| `PSN_TARGET_ONLINE_ID` | да | сервер | PSN ID отслеживаемого аккаунта (Артёма) |
| `TOKEN_ENCRYPTION_KEY` | да | сервер | ключ AES-256-GCM для токенов в `psn_auth`: 32 байта в base64 |
| `PSN_REQUEST_DELAY_MS` | нет, 300 | сервер | пауза между запросами к PSN |
| `SYNC_TIME_BUDGET_MS` | нет, 50000 | сервер | бюджет времени одного вызова синка до остановки с курсором; значение ограничивается сверху 55000 (`maxDuration = 60`) |
| `SYNC_ORIGIN` | нет | сервер | доверенный origin для самовызова продолжения синка (туда уходит Bearer `CRON_SECRET`), например `https://ps.example.com`. Если не задан: на Vercel `VERCEL_PROJECT_PRODUCTION_URL` (production) или `VERCEL_URL`; вне production `http://localhost:$PORT` (3000). Из запроса (Host, `req.url`) origin не берётся. Нет ни одного = цепочка не продолжается, остаётся cron/кнопка |
| `TELEGRAM_BOT_TOKEN` | нет | сервер | Этап 2 (15.4): токен бота для предупреждений о протухании NPSSO. Без пары `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` модуль уведомлений ничего не делает. Секрет: не логируется, не попадает в ответы и `error_message` |
| `TELEGRAM_CHAT_ID` | нет | сервер | Этап 2 (15.4): id чата (личный чат с ботом или группа), куда бот шлёт сообщения. Этап 5 (20.2, 20.3): также алерт «синк не запускался» и еженедельная копия разметки |
| `APP_ORIGIN` | нет | сервер | Фаза 18 (15.4): публичный адрес сайта `https://<домен>` для абсолютных ссылок на игры в Telegram. Не задана: ссылок нет, остальное работает |
| `RAWG_API_KEY` | нет | сервер | Фаза 12 (17.2, 17.9): ключ rawg.io/apidocs для поиска релизов. Без него поиск отвечает `503 catalog_unavailable`. Секрет: не логируется, не попадает в ответы |
| `APP_TIMEZONE` | нет | - | **не используется**: часовой пояс жёстко `Europe/Moscow` в константе кода |

Запрещено: логировать любую из переменных, `PSN_NPSSO`, токены, заголовки `Authorization` и `Cookie`. В `error_message` синка токены вырезаются.

## 6. Правила миграций
1. Источник истины схемы: `src/db/schema.ts`. SQL-миграции генерирует `drizzle-kit generate` в `src/db/migrations/`, коммитятся в репозиторий. Править сгенерированный SQL вручную можно только для данных/индексов, которые drizzle не выражает (партиальные индексы, CHECK, partial UNIQUE), с комментарием.
2. Применение (Фаза 46): CI, job `DB migrate (prod)` в `.github/workflows/ci.yml`, раннер `src/db/migrate-runner.ts` (CLI `npm run db:ci status|plan|apply|verify`, строка owner без pooler в `MIGRATE_DATABASE_URL`). Журнал тот же, что у drizzle (`drizzle.__drizzle_migrations`, hash = sha256 файла, created_at = `when`); раннер дополнительно сверяет журнал базы с репозиторием и применяет каждую миграцию в своей транзакции. **Не** при старте приложения и не в рантайме функции. Порядок и настройка: `docs/release.md` §6.
3. Миграции только вперёд (down-миграций нет); исправление = новая миграция. Одна миграция = одно логическое изменение.
4. Совместимость: двухшаговые изменения (expand -> contract). Добавление колонки с default или nullable безопасно; переименование и удаление делаются отдельной миграцией после выката кода.
5. **Миграции с потерей данных** (`DROP TABLE/COLUMN`, сужение типа, `TRUNCATE`, `DELETE` без возможности восстановления) требуют согласия Артёма через оркестратора. В заголовке такой миграции комментарий `-- DATA LOSS: <что теряется>`.
6. Перед продом CI применяет миграции на временной ветке Neon от прода и сверяет схему с чистой базой; на прод — только после этого. Миграция с `-- DATA LOSS:` ждёт Approve Артёма в GitHub (environment `production-db-approve`).
7. Таблицы `game_status` и `playtime_snapshots` содержат невосстановимые данные (ручные статусы, история часов): перед любыми изменениями этих таблиц сделать backup/ветку Neon.
8. Начальная миграция `0000` создаёт все таблицы и enum из раздела 1 целиком.
9. Seed-данных нет. Тестовые фикстуры живут в тестах.

## 7. Открытые вопросы (к оркестратору)
1. Расписание cron `0 20 * * *` (23:00 МСК) и фиксация `snapshot_date` по МСК согласовать (повлияет на `vercel.json`).
2. Хранение refresh token PSN в БД в зашифрованном виде (`psn_auth`) нужно для суточного продления (~10 дней жизни); альтернатива (только env) невозможна, так как env нельзя обновлять из функции. Подтвердить.
3. Процесс обновления NPSSO при `auth_expired` (кто и как меняет `PSN_NPSSO` на Vercel): нужен регламент и индикатор в UI.
4. Продолжение `partial`-синка: решено в разделе 8.2 (цепочка самовызовов через `after()`, запасной путь: следующий cron или кнопка).
5. Имя `ADMIN_PASSWORD` минимальная длина 12 и `Secure`-cookie в dev на `http://localhost`: оставить как есть?

## 8. Синк (Фаза 2)

### 8.1 Фазы и курсор
Одно звено = один вызов функции с бюджетом `SYNC_TIME_BUDGET_MS`. Порядок фаз:

| Фаза (`sync_runs.phase`) | Что делает | Единица работы |
|---|---|---|
| `auth` | access token: из `psn_auth`, если живёт ещё >2 мин; иначе refresh; иначе `PSN_NPSSO` (1.8). Затем `getProfileFromUserName` -> `accountId` (каждое звено, 1 запрос, в курсор не пишется) | - |
| `games` | `getUserPlayedGames` (страницы по 200), фильтр по `category`, апсерт `games`, снимки `playtime_snapshots` | одна транзакция на весь список (~214 строк); при обрыве повторяется целиком, это идемпотентно |
| `trophy_sets` | `getUserTitles` (с пагинацией), апсерт `trophy_sets` | одна транзакция |
| `trophy_link` | игры, виденные в этом запуске, с `trophy_checked_at IS NULL` или (`< now()-7 дней` и без связей): `getUserTrophiesForSpecificTitle` пачками по 5 titleId, апсерт сетов из ответа, связи `source=title_id`, `trophy_checked_at = now()`. В конце фазы: наследование по `concept_id` (`source=concept`), затем fallback по нормализованному имени только для сетов-сирот и только при однозначном совпадении с игрой без связей (`source=name`) | пачка = транзакция. Остаток определяется данными (выборка ещё не проверенных) |
| `trophies` | сеты, требующие загрузки: `getUserTrophiesEarnedForTitle` (earned, `earned_at`, тип, редкость) и `getTitleTrophies` (имя, описание, иконка) только если строк трофеев в БД меньше суммы `defined_*`; апсерт `trophies`, `trophies_synced_at = now()` | один сет = транзакция |

Сет считается устаревшим (нужна загрузка), если: `trophies_synced_at IS NULL`, или `last_updated_at > trophies_synced_at`, или (`trophies_synced_at` старше суток и число строк `trophies` не равно сумме `defined_*` либо число `earned=true` не равно сумме `earned_*`). Условие «старше суток» не даёт бесконечно перезагружать сет, по которому PSN отдаёт расхождение.

Курсор `sync_runs.cursor` (jsonb, без секретов): `{"phase":"trophies","hops":2,"heartbeat":"2026-10-27T20:01:00.000Z","progress":{"done":40,"total":170}}`. `phase` = с чего продолжать; `hops` = сколько раз цепочка самовызвалась (при ручном/суточном возобновлении сбрасывается в 0); `heartbeat` = момент последней записи состояния, по нему «брошенный» запуск определяется как `running` без heartbeat 15 минут (иначе длинный запуск, у которого `started_at` давно, закрывался бы ошибочно); Гарантия прогресса: звено останавливается по бюджету только после хотя бы одной завершённой единицы работы; `progress` относится к текущей фазе (пересчитывается при входе: `total = done + осталось`). Остаток работы определяют данные, а не только курсор, поэтому потеря курсора безопасна. Курсор и счётчики обновляются в той же транзакции, что и батч.

Оценка первого синка: игры, сеты и 43 пачки по 5 (около 50 запросов), затем до ~340 запросов трофеев при паузе 300 мс плюс время ответа: порядка 3 звеньев. Последующие синки: игры + сеты + только изменившиеся сеты, как правило одно звено.

### 8.2 Продолжение между батчами: решение
Ограничения: Vercel Hobby, cron только раз в сутки (нельзя «cron каждую минуту»); время функции ограничено (закладываем `maxDuration = 60` с, `SYNC_TIME_BUDGET_MS = 50000`, остаток на последний батч и закрытие запуска).

Выбрано: **цепочка самовызовов через `after()` (`next/server`)**.
1. Вход (`GET /api/cron/sync` или `POST /api/sync`) синхронно создаёт или возобновляет запуск (быстро, только БД) и **сразу отвечает `202`**. Работа выполняется в `after()` той же функции (до `maxDuration`).
2. Если звено остановилось по бюджету (`partial` + `error_reason = 'timeout'`), оно в конце вызывает `GET /api/cron/sync?continue=<runId>&hop=<N>` (N = `cursor.hops` после звена) с `Authorization: Bearer <CRON_SECRET>`; origin только из доверенной конфигурации (`SYNC_ORIGIN` и т.д., см. раздел env), не из запроса. Принимающее звено отвечает `202` сразу и работает в своём `after()`, поэтому вызывающему не нужно ждать ~50 с.
3. Предохранители: `cursor.hops` не больше `MAX_HOPS` = 60 (~час работы; библиотеки на 1000+ наборов трофеев) (затем запуск остаётся `partial`); проверяется и у отправителя, и у получателя: `continue` без `hop` = `400`; `hop` больше `MAX_HOPS`, не равный `cursor.hops` запуска (повтор старого вызова) или `cursor.hops` больше `MAX_HOPS` = `200 not_resumable`; `continue=<runId>` возобновляет только запуск `partial` с `error_reason = 'timeout'`; один `running` на систему (партиальный UNIQUE, 1.7).
4. Запасной путь, если цепочка оборвалась: следующий суточный cron или кнопка «Синк сейчас» возобновляют последний `partial`-запуск, если ему меньше 6 часов, иначе начинают новый запуск (работа всё равно продолжится с того места, до которого дошли данные).

Почему не остальные варианты:
- Повторный cron: на Hobby недоступен чаще раза в сутки.
- `after`/`waitUntil` сами по себе: продлевают жизнь той же функции, но не выходят за `maxDuration`, то есть тот же один бюджет.
- Самовызов с ожиданием ответа: вызывающая функция тратила бы свой лимит на ожидание.

Риски: Deployment Protection на preview блокирует самовызов (production не затронут); платформа может оборвать `after()`: тогда запуск остаётся `running` и через 15 минут закрывается как `failed`/`timeout`, дальше работает запасной путь (п.4). Брошенный запуск: `running` старше 15 минут закрывается при старте следующего (`failed`, `timeout`), данные не трогаются.

### 8.3 `POST /api/sync` («Синк сейчас»)
Под сессией (proxy). `Content-Type: application/json` обязателен, `Origin` проверяется (3.4). Тело `{}` (игнорируется).
- **202** `{"ok":true,"data":{"started":true,"resumed":false,"run":{"id":13,"kind":"manual","status":"running","phase":"games"}}}`. `resumed=true`, если продолжен свежий `partial`.
- **409** `sync_in_progress`: синк уже идёт, `details: {"runId": 13}`. UI показывает прогресс.
- **500** `config_error`: не заданы `PSN_TARGET_ONLINE_ID` / `TOKEN_ENCRYPTION_KEY` (не короче 32 байт в base64) / `DATABASE_URL`. **503** `db_unavailable`.
- Ошибки самого PSN в этот ответ не попадают (запрос уже принят): они видны в `GET /api/sync/status` после завершения звена. Отсутствие `PSN_NPSSO` при пустом `psn_auth` проявится как `npsso_invalid` в статусе.

`GET /api/cron/sync` (Bearer `CRON_SECRET`, вид запуска `daily`): **202** `{"started":true,"resumed":false,"runId":13}`; **200** `{"started":false,"reason":"already_running","runId":13}`; для `continue`: **200** `{"started":false,"reason":"not_resumable"}`. Те же `config_error`/`db_unavailable`.

### 8.4 `GET /api/sync/status`
Под сессией, только БД, к PSN не обращается. Кнопка «Синк сейчас» опрашивает его каждые 2-3 с, пока `running`.
```json
{
  "ok": true,
  "data": {
    "running": true,
    "run": {
      "id": 13, "kind": "manual", "status": "running",
      "phase": "trophies", "errorReason": null, "errorMessage": null,
      "startedAt": "2026-10-27T20:00:03.000Z", "finishedAt": null, "snapshotDate": "2026-10-27",
      "progress": { "phase": "trophies", "step": 4, "steps": 4, "done": 40, "total": 170 },
      "counters": { "gamesSeen": 214, "gamesUpserted": 214, "snapshotsWritten": 214, "trophySetsSynced": 40, "trophiesUpserted": 1830 },
      "warningsCount": 0
    },
    "lastSuccessAt": "2026-10-26T20:01:10.000Z",
    "psnAuth": "ok",
    "psnAuthExpiresAt": "2026-11-05T20:00:09.000Z",
    "totals": { "games": 214, "trophySets": 170, "trophies": 9120, "trophiesEarned": 4310, "platinumEarned": 38 }
  }
}
```
- `totals` = итоги из БД (не счётчики последнего запуска), один агрегатный запрос: `games` = строки `games`, `trophySets` = строки `trophy_sets`, `trophies` = строки `trophies`, `trophiesEarned` = `trophies.earned = true`, `platinumEarned` = `earned` и `type = 'platinum'`. Целые числа, при пустой БД 0.
- `run` = последняя запись `sync_runs` или `null`. `running` = есть запись со статусом `running`.
- `progress.step`/`steps`: номер фазы среди `games, trophy_sets, trophy_link, trophies`; `done`/`total` заполнены только для `trophy_link` и `trophies`, иначе `null`.
- `lastSuccessAt` = `finished_at` последнего `success`.
- `psnAuth`: `ok | auth_expired | unknown`, как в 4.3. `psnAuthExpiresAt` = `psn_auth.refresh_expires_at` (ориентир, когда истечёт refresh, если синки перестанут идти) или `null`. Токены не отдаются никогда.
- `errorMessage` санитизирован (8.6).
- Фаза 16.2: добавлено поле верхнего уровня `overdue: { isOverdue, ageHours, thresholdHours }` (синк не успешен дольше 30 ч), см. 20.2.

### 8.5 Поведение при ошибках PSN
Общее правило: **данные не удаляются и не обнуляются ни при какой ошибке**; снимки пишутся только после успешного получения полного списка игр.

| Ситуация | Повторы | Итог запуска | Цепочка | UI |
|---|---|---|---|---|
| `auth_expired` (refresh отвергнут и NPSSO отвергнут при наличии прежнего refresh) / `npsso_invalid` (refresh не было, NPSSO отвергнут) | нет | `failed` | нет | `psnAuth=auth_expired`, баннер «нужен новый NPSSO», старые данные |
| `access_denied` (приватность цели) | нет | `failed` | нет | ошибка в статусе, старые данные |
| `rate_limited` (429), `psn_unavailable` (5xx, сеть, не-JSON) | 3 повтора, паузы 1/2/4 с | `failed`, если фаза `games` не завершена; иначе `partial` с курсором | нет | ошибка в статусе; следующий cron/кнопка продолжит |
| бюджет времени исчерпан | - | `partial` + `timeout` | да (8.2) | прогресс |
| 401 в середине запуска (access token умер) | один принудительный refresh и повтор вызова | как выше | - | - |
| наша ошибка (БД и т.п.) | нет | `failed`, `internal` | нет | ошибка в статусе |

`psn-api` не отдаёт HTTP-статус, только `Error.message`. Его обмен токенов теряет статус и тело ошибки (возвращает объект с `undefined`), поэтому обмен NPSSO/refresh сделан в `src/server/psn/auth.ts` напрямую по HTTP: отказ (`invalid_grant`/400/401/403 на токен-эндпоинте, 3xx без `code` на `/authorize`) = `auth_expired`/`npsso_invalid`; 429 = `rate_limited`; 5xx, сеть, ответ без токенов без признака отказа = `psn_unavailable`; два последних повторяются (паузы 0,5 и 1,5 с, затем ошибка запуска). Остальные вызовы: классификация по тексту в `src/server/psn/errors.ts`; если текст = JSON-ответ GraphQL, анализируются только поля `message`/`error`/`code` (числа 401/404 внутри id не считаются), «access token» без слов invalid/expired отказом не считается. Неизвестная ошибка PSN = `psn_unavailable` (с повторами).

### 8.6 Безопасность синка
- Токены и NPSSO не логируются; `error_message` проходит `safeErr`: вырезаются известные секреты (точное совпадение), `Bearer ...`, JWT, длинные base64url-подобные строки; обрезка до 500 символов.
- В `cursor`, `warnings`, ответах API секретов нет.
- `warnings` (максимум 50): `playtime_decreased` (PSN отдал время меньше сохранённого), `name_link_ambiguous` и т.п.

### 8.7 Правила статусов (код)
`src/server/sync/status-rules.ts` реализует правила 1.3: чистая функция перехода + запись в БД. Синк в `game_status` не пишет.

### 8.8 Остановка и перезапуск синка (Фаза 32.1)
Пользователь может остановить идущий синк и запустить его заново. Миграция `0023_sync_cancelled` (`docs/release-neon-0023.sql`): только `ALTER TYPE sync_error_reason ADD VALUE IF NOT EXISTS 'cancelled'`, данные не меняются. Значение enum нельзя использовать в той же транзакции, где оно добавлено, поэтому миграция ничего не пишет с ним.

**Состояние отменённого запуска:** `status = 'failed'`, `error_reason = 'cancelled'`, `error_message` = «Остановлено пользователем.» (если отменил владелец чужой запуск: «Остановлено владельцем.»), `finished_at = now()`. Слот `running` (1.7) освобождается сразу. `cursor`, счётчики, `warnings` и все данные игр/трофеев/снимков **не трогаются** (курсор остаётся для перезапуска). `cancelled` не ошибка: красный баннер не показывается, Telegram-алерты о сбое (15.4, 22.13) по самой отмене не отправляются, `GET /api/health` не считает такой запуск `degraded`. Алерт `sync_missed` (20.2) остаётся временным: он смотрит только на давность последнего `success`.

#### `POST /api/sync/cancel`
Под сессией (proxy + `requireUser`), `Content-Type: application/json`, `Origin` проверяется (3.4). Тело `{}` или `{"userId": 5}`.
- Без `userId`: отменяется идущий запуск (`status='running'`, `kind <> 'hltb'`) **текущего** пользователя. Запрос атомарный: `UPDATE sync_runs SET status='failed', error_reason='cancelled', ... WHERE user_id = :uid AND status = 'running' AND kind <> 'hltb' RETURNING id` (слот `running` один на систему, поэтому строка не больше одной).
- С `userId`: только владелец (`role = owner` по БД) может отменить запуск другого пользователя. `member` с чужим `userId` = **403** `forbidden` (даже если у того нет запуска: наличие чужого запуска не раскрывается). `userId` равный своему id разрешён всем. Невалидный `userId` (не положительное целое) = 400 `invalid_request`.
- **200** `{"ok":true,"data":{"cancelled":true,"runId":13}}`. Идемпотентно: если запуска нет (уже завершён, уже отменён, `partial` между звеньями, у `userId` нет запуска или такого пользователя нет) = **200** `{"ok":true,"data":{"cancelled":false,"runId":null}}`.
- Запуски `kind='hltb'` (16.7) этим эндпоинтом не отменяются (они короткие и закрываются сами).
- 401 нет сессии; 503 `db_unavailable`; 503 также на старой схеме без `0023` (значение enum не принимается): отмена и restart недоступны, остальное (статус, health, обычный запуск, синк) работает, сравнение `error_reason` с `cancelled` делается как текст.
- Отмена не ждёт остановки работы: звено может доработать текущую единицу работы (одну пачку запросов PSN), но не пишет данные игр, трофеев, снимков и курсор (транзакция батча откатывается; идемпотентные дописывания tint/hltb/llm/discover и дублей возможны до следующего `save`, см. ниже). Новый синк можно запускать сразу.

**Правила движка (`RunContext.save`):** запись состояния `UPDATE ... WHERE id AND user_id AND status = 'running'`. 0 строк = запуск отменён (или закрыт как брошенный) -> бросается `RunCancelledError`. Так как `save` вызывается внутри транзакции батча, транзакция откатывается: отменённый запуск не пишет ни строки данных, ни курсора. Звено завершается результатом `failed/cancelled`, `continueNext = false` (самовызов не делается). `close` (запись `success/partial/failed`) тоже идёт через `save`: он не перезаписывает отменённый запуск. `GET /api/cron/sync?continue=<runId>` на отменённый запуск = `200 not_resumable` (возобновляется только `partial` + `timeout`). `work()` в `service.ts` на `cancelled` не вызывает `notifyAfterSync` и не отмечает онбординг; для `kind='daily'` обход пользователей (22.13) продолжается.

**Окно гонки.** Отмена действует только на `status='running'`. Между звеньями (8.2) запуск на доли секунды `partial`: отмена в этот момент вернёт `cancelled:false`, цепочка продолжится. UI опрашивает `GET /api/sync/status` и при `running` после такого ответа может повторить отмену.

#### `POST /api/sync` с `{"restart": true}`
Тело 8.3 получает необязательное поле `restart` (только булево `true`; иное игнорируется). Порядок: проверка пользователя и настроек (как у обычного старта), затем отмена идущего запуска этого пользователя (как выше), затем старт нового.
- Новый запуск `kind='manual'`, **продолжает с сохранённого места**: курсор отменённого запуска переносится в новый как `{phase: <phase отменённого>, hops: 0, heartbeat: now}`; `progress` не переносится (пересчитывается при входе в фазу, 8.1), счётчики нового запуска с нуля. Перенос только если отменённый запуск начался в ту же дату МСК и не раньше чем 6 часов назад (`RESUME_WINDOW`; чтобы не пропустить фазу `games` и снимки часов нового дня); иначе запуск начинается с фазы `games`.
- Потеря прогресса трофеев исключена в любом случае: остаток работы фаз `trophy_link`/`trophies` определяют данные (8.1: ещё не проверенные игры, устаревшие сеты), а не курсор.
- Если идущего запуска нет, `restart` ведёт себя как обычный `POST /api/sync` (в том числе возобновляет свежий `partial`).
- Ответ как у 8.3 (202), плюс поля `data.restarted` (`true`, если был отменён идущий запуск) и `data.cancelledRunId` (id отменённого или `null`). `resumed=true`, если курсор перенесён и новый запуск начинается позже фазы `games`, либо продолжен свежий `partial`.
- Ошибки как у 8.3 (`409 sync_in_progress`, `409 psn_not_set`, ...). Если после отмены слот успел занять чужой запуск (например, cron другого пользователя), ответ `409 sync_in_progress`, отменённый запуск остаётся отменённым, повторное нажатие запустит синк.
- Обычный `POST /api/sync` без `restart` после отмены начинает **новый** запуск с фазы `games` (`failed` не возобновляется), прогресс трофеев сохраняется данными.

#### Статус и health
- `GET /api/sync/status` (8.4): `run.status = 'failed'`, `run.errorReason = 'cancelled'`, `run.errorMessage` = текст выше; `running = false` сразу после отмены. `psnAuth` вычисляется по последнему завершённому запуску **кроме отменённых** (отмена не скрывает прежний `auth_expired`).
- `GET /api/health` (4.3): `sync.lastRun.errorReason = 'cancelled'`; такой `lastRun` не делает `data.status = 'degraded'`; `psnAuth` считается так же, без отменённых.
- Обход cron (22.13): при отмене `daily`-запуска обход переходит к следующему пользователю, когда звено доработает текущую единицу работы; при `restart` `daily`-запуск заменяется ручным, и следующий пользователь запустится следующим суточным cron.

## 9. Коллекция (Фаза 3)

Все эндпоинты под сессией (proxy, 3.4), конверт по разделу 4. Мутации (PUT/PATCH/POST) требуют `Content-Type: application/json` и проверку `Origin` (3.4), иначе `400 invalid_request`. К PSN не обращаются, только БД. БД недоступна: `503 db_unavailable`. Типы ответов экспортируются из `src/server/collection/types.ts` (только типы, безопасно импортировать во frontend через `import type`).

### 9.1 Объект игры (`GameItem`)
Общий для всех ответов раздела.
```json
{
  "id": 17,
  "title": "Horizon Forbidden West",
  "coverUrl": "https://image.api.playstation.com/....png",
  "platform": "PS5",
  "playSeconds": 101853,
  "hours": 28.3,
  "playCount": 19,
  "lastPlayedAt": "2026-10-05T18:42:11.000Z",
  "status": "completed",
  "completedAt": "2026-10-05T18:42:11.000Z",
  "droppedAt": null,
  "trophies": {
    "earned": 54,
    "defined": 78,
    "progress": 69,
    "platinumDefined": true,
    "platinumEarned": false,
    "byType": {
      "platinum": { "earned": 0, "defined": 1 },
      "gold": { "earned": 3, "defined": 8 },
      "silver": { "earned": 14, "defined": 20 },
      "bronze": { "earned": 37, "defined": 49 }
    }
  },
  "genres": [
    { "key": "ACTION", "label": "Экшен" },
    { "key": "ROLE_PLAYING_GAMES", "label": "Ролевые" }
  ],
  "hiddenAt": null
}
```
| Поле | Правило |
|---|---|
| `title` | `games.name` |
| `coverUrl` | `games.image_url` или `null` (UI рисует плейсхолдер с названием) |
| `platform` | из `games.category`: `ps4_game` -> `"PS4"`, `ps5_native_game` -> `"PS5"`, `pspc_game` -> `"PC"` |
| `playSeconds` | `play_duration_seconds` (точное значение для «28 ч 17 мин») |
| `hours` | `playSeconds / 3600`, округлено до 0.1. 0 если игра не запускалась |
| `playCount` | `play_count` |
| `lastPlayedAt` | ISO UTC или `null` (игра ни разу не запускалась / PSN не отдал дату) |
| `status` | `playing \| completed \| dropped \| backlog \| shelved \| service` или `null` («без статуса») |
| `completedAt` / `droppedAt` | ISO UTC; не `null` только при соответствующем статусе (1.3) |
| `trophies` | `null`, если у игры нет трофейного сета (нет строк в `game_trophy_sets`) или в сетах `defined = 0`. UI показывает «нет данных». Иначе объект |
| `trophies.earned` / `defined` | сумма `earned_*` / `defined_*` по всем сетам игры (правило 1.4; значения из `trophy_sets`, кэш `getUserTitles`) |
| `trophies.progress` | целое 0..100: `round(earned / defined * 100)`. Это не `trophy_sets.progress` PSN (его взвешивание по типам не используется) |
| `trophies.platinumDefined` / `platinumEarned` | в сетах есть платина / платина получена (`sum(defined_platinum) > 0`, `sum(earned_platinum) > 0`) |
| `trophies.byType` | `earned`/`defined` по типам для нижней полосы карточки |
| `hiddenAt` | Фаза 8: `games.hidden_at` ISO UTC или `null` (игра видна). Не `null` только в ответах, где скрытые игры допустимы: `GET /api/games?hidden=only`, ответы `PUT .../hidden`, `PUT .../status`, `PATCH .../status-date` по скрытой игре |
| `genres` | эффективные жанры по 1.9: `genres_override ?? normalize(psn_genres)`, подписи RU из словаря. Порядок как у PSN, дубли схлопнуты. Никогда не пустой массив: нет данных = `[{"key":"OTHER","label":"Другое"}]`. Ключи: `ACTION, ADVENTURE, ROLE_PLAYING_GAMES, SHOOTER, HORROR, RACING, SIMULATION, FIGHTING, ARCADE, MUSIC_RHYTHM, CASUAL, STRATEGY, PUZZLE, FAMILY, PARTY, OTHER` |

### 9.2 `GET /api/games`
Query-параметры (все необязательные; неизвестные игнорируются):
| Параметр | Значение | По умолчанию |
|---|---|---|
| `q` | поиск по названию, подстрока, регистронезависимо (`ILIKE`, спецсимволы `%` `_` `\` экранируются). Пробелы по краям обрезаются, пустая строка = без поиска. Максимум 100 символов, больше = `400` | нет |
| `status` | список через запятую из `playing, completed, dropped, backlog, shelved, service, none` (`none` = без статуса). Несколько = объединение (ИЛИ). Дубли допустимы. Неизвестное значение = `400` | все |
| `year` | целое 2000..2100, см. правило года ниже. Иначе `400` | все годы |
| `sort` | `last_played \| hours \| title \| trophies_progress \| completed_at` | `last_played` |
| `order` | `asc \| desc` | зависит от `sort` (ниже) |
| `limit` | 1..300 | 60 |
| `offset` | >= 0 | 0 |
| `hidden` | Фаза 8. `only` = только скрытые игры (раздел «Скрытые» в настройках). Нет параметра или пустая строка = только видимые. Другое значение = `400` | только видимые |

**Правило года (`year`).** Год считается ТОЛЬКО по дате завершения = `coalesce(completed_at, dropped_at)`, год по Europe/Moscow. Fallback на `last_played_at` нет. Игра без `completed_at` и `dropped_at` (`playing`, `backlog`, `shelved`, без статуса, а также пройденная/брошенная без даты) не попадает ни в один год и скрывается при любом заданном `year`. `completed_at`/`dropped_at` по правилу 1.3 по умолчанию равны `last_played_at` в момент смены статуса, а затем правятся вручную, поэтому ручная правка двигает игру между годами.

**Сортировка.** Всегда добавляется стабильный хвост: `lower(title) asc, id asc`. `NULL` всегда в конце, независимо от `order`.
| `sort` | Ключ | `order` по умолчанию |
|---|---|---|
| `last_played` | `last_played_at` | `desc` |
| `hours` | `play_duration_seconds` | `desc` |
| `title` | `lower(title)` | `asc` |
| `trophies_progress` | `trophies.progress` (точное отношение `earned/defined`, затем `earned`); игры без сета (`trophies = null`) в конце | `desc` |
| `completed_at` | `coalesce(completed_at, dropped_at)` («дата завершения»: у пройденных дата прохождения, у брошенных дата броска); игры без обеих дат в конце | `desc` |

Ответ 200:
```json
{
  "ok": true,
  "data": {
    "items": [ { "...": "GameItem по 9.1" } ],
    "total": 63,
    "limit": 60,
    "offset": 0,
    "counts": { "all": 214, "playing": 3, "completed": 61, "dropped": 9, "backlog": 25, "shelved": 4, "service": 6, "none": 112 },
    "years": [2026, 2025, 2024]
  }
}
```
- `total`: число игр после **всех** фильтров (`q`, `status`, `year`), до `limit/offset`. Страница = `items`.
- `counts`: для табов статуса. Считаются с учётом `q` и `year`, но **без** фильтра `status` (иначе нельзя показать, сколько игр в соседнем табе). `all` = сумма остальных шести. Все семь ключей присутствуют всегда, при пустой БД нули.
- `years`: годы завершений (по правилу года: только `completed_at`/`dropped_at`), в которых завершена хотя бы одна игра во **всей** коллекции (без `q`/`status`), по убыванию. Для выпадающего списка «Все годы». Пустая БД: `[]`.
- Пустая БД / нет совпадений: `items: []`, `total: 0`, счётчики нули, `200`.
- `offset` за пределами: `items: []`, `total` настоящий.
- Видимость (9.10): `items`, `total`, `counts`, `years` считаются в одной области: без `hidden` только видимые игры, при `hidden=only` только скрытые (`counts`/`years` тогда описывают скрытые). Сортировка при `hidden=only` та же, по `sort`/`order`.

### 9.3 `GET /api/collection/summary`
Данные для шапки статистики (4.2), блока «Играю сейчас» (4.3) и секции «Продолжить».
```json
{
  "ok": true,
  "data": {
    "totals": { "games": 214, "playSeconds": 6943201, "hours": 1928.7, "trophiesEarned": 4310, "platinumEarned": 38 },
    "counts": { "all": 214, "playing": 3, "completed": 61, "dropped": 9, "backlog": 25, "shelved": 4, "service": 6, "none": 112 },
    "playing": [ { "...": "GameItem" } ],
    "services": [ { "...": "GameItem" } ],
    "continue": [ { "...": "GameItem" } ]
  }
}
```
- `totals.games` = строки `games`; `playSeconds`/`hours` = сумма по `games.play_duration_seconds` (`hours` до 0.1); `trophiesEarned` = строки `trophies` с `earned = true`; `platinumEarned` = из них `type = 'platinum'` (как `totals` в 8.4, включает трофеи сетов-сирот, поэтому может быть больше суммы по `GameItem`).
- `counts`: как в 9.2 без фильтров.
- `playing`: все игры со статусом `playing`, сортировка `last_played_at desc nulls last, lower(title), id`, максимум 20. UI берёт `playing[0]` для блока «Играю сейчас» (4.3 «с самым свежим последним запуском»); пусто = блок скрыт.
- `services`: игры со статусом `service` («игры-сервисы», отдельный блок главной), сортировка `last_played_at desc nulls last, lower(title), id`, максимум 50; общее число = `counts.service`. Пусто = блок скрыт. Игра в `services` может быть и в `continue` (дубль на главной убирает фронтенд).
- `continue`: до 8 игр для секции «Продолжить». **Правило:** `last_played_at IS NOT NULL` и статус не `completed` и не `dropped` (то есть `playing`, `backlog`, `shelved`, `service`, без статуса), сортировка `last_played_at desc, id desc`. Игры, включённые в `playing`, **не исключаются** (дизайн 4.3: «playing + недавно запущенные»); если блок «Играю сейчас» уже показывает `playing[0]`, дубль на карточке в ряду фронтенд убирает сам. Окна по давности нет: при малом числе подходящих игр ряд короче 8 или пуст.
- Пустая БД: нули, `playing: []`, `services: []`, `continue: []`.
- Фаза 8: все поля считаются только по видимым играм (9.10). `totals.trophiesEarned`/`platinumEarned` не считают трофеи сетов, связанных только со скрытыми играми (сеты-сироты по-прежнему считаются).

### 9.4 `PUT /api/games/{id}/status`
Тело: `{"status": "playing"}` где `status` одно из шести значений либо `null` (сброс в «без статуса» = `DELETE` строки `game_status`). Остальные поля тела игнорируются; `status` обязателен (отсутствующий ключ = `400`).
- 200: `{"ok":true,"data":{"game":{ "...": "GameItem после изменения" }}}`.
- Правила дат: 1.3 (`computeStatusChange`): `completed`/`dropped` берут `last_played_at` (нет его: `now()`), уход со статуса обнуляет дату, повтор того же статуса ничего не трогает (в том числе ручную правку даты).
- Идемпотентен: повторный вызов с тем же телом даёт тот же `200` и то же состояние.
- 400 `invalid_request`: `id` не положительное целое, тело не JSON, `status` не из списка. 404 `not_found`: игры нет.

### 9.5 `PATCH /api/games/{id}/status-date`
Тело: ровно одно из `{"completedAt": "2026-09-20T00:00:00.000Z"}` или `{"droppedAt": "..."}`. Значение: ISO 8601 с `Z` или смещением. Оба поля сразу, ни одного, значение `null` или не ISO = `400`.
- 200: `{"ok":true,"data":{"game":{ "...": "GameItem" }}}`. Меняется только эта дата и `updated_at` (правило 1.3.5); `statusChangedAt` не трогается.
- 400 `invalid_request`: невалидное тело, дата в будущем (строго больше `now()` сервера).
- 404 `not_found`: игры нет.
- 409 `status_conflict`: у игры нет статуса или он не соответствует (`completedAt` при статусе не `completed`, `droppedAt` при статусе не `dropped`). `details: {"status": "backlog" | null}` (текущий статус).
- Порядок проверок: id и тело (400) -> игра (404) -> соответствие статуса (409) -> дата в будущем (400). Дата в будущем проверяется после статуса, но до записи.

### 9.6 `POST /api/games/status-bulk`
Массовая смена статуса (режим выбора в 4.6). Тело: `{"ids": [17, 18, 42], "status": "backlog"}`; `status` как в 9.4 (допустим `null`).
- `ids`: массив положительных целых, 1..1000 штук (`BULK_MAX`, этап 3, R4; было 250). Дубли схлопываются без ошибки. Больше 1000 или пустой = `400`. Клиент шлёт один запрос на всё выделение, не пачками: вся выборка меняется атомарно в одной транзакции.
- Атомарно: одна транзакция, все или ничего. Если хотя бы одного `id` нет в БД: `404 not_found`, `details: {"missingIds": [999]}`, ничего не изменено.
- Правила дат те же, что в 9.4, для каждой игры отдельно (у кого статус уже такой, не трогаются). Запросов к БД фиксированное число, не N.
- 200:
```json
{
  "ok": true,
  "data": {
    "requested": 3,
    "changed": 2,
    "games": [ { "...": "GameItem после изменения, в порядке возрастания id" } ]
  }
}
```
`requested` = число уникальных id; `changed` = у скольких статус реально изменился (уже имевшие такой статус не считаются).

Сброс статуса (Фаза 8.3): одна игра = 9.4 с `{"status": null}`, выделение = 9.6 с `"status": null`. Скрытые игры (9.10) в 9.6 считаются отсутствующими: `404 not_found` с ними в `details.missingIds`, ничего не изменено. 9.4 и 9.5 для скрытой игры работают (статус сохраняется при возврате).

### 9.7 `PUT /api/games/{id}/hidden` (Фаза 8)
Мягкое «удаление из коллекции». Тело `{"hidden": true}` или `{"hidden": false}`; ключ обязателен, значение только boolean, иначе `400 invalid_request`.
- `true`: `hidden_at = now()`, если игра ещё видна; уже скрытая не трогается (исходный `hidden_at` сохраняется). `false`: `hidden_at = NULL`.
- `game_status` не трогается: при возврате игра возвращается со своим статусом и датами.
- 200: `{"ok":true,"data":{"game":{ "...": "GameItem, hiddenAt заполнен при hidden=true" }}}`. Идемпотентен.
- 400 `invalid_request` (id, тело, Content-Type/Origin по 3.4). 404 `not_found`: игры нет.

### 9.8 `POST /api/games/status-reset-all` (Фаза 8)
Сброс статусов всей коллекции в «без статуса». Тело строго `{"confirm": "RESET"}`, иначе `400 invalid_request` (защита от случайного вызова).
- Одна транзакция: (1) в `status_backups` пишется снимок (`reason = reset_all`) всех строк `game_status` **видимых** игр; (2) эти строки удаляются; (3) ротация бэкапов до 10 последних. Статусы скрытых игр не трогаются и в снимок не входят.
- Если сбрасывать нечего (0 строк), бэкап не создаётся.
- 200:
```json
{ "ok": true, "data": { "backupId": 7, "reset": 61 } }
```
`backupId`: id созданного бэкапа или `null`, если `reset = 0`. `reset`: сколько статусов удалено. UI показывает toast «Статусы сброшены» с кнопкой «Вернуть» -> 9.9 с этим `backupId`.

### 9.9 `POST /api/games/status-restore` (Фаза 8)
Откат из бэкапа. Тело `{"backupId": 7}` (положительное целое), иначе `400 invalid_request`.
- Одна транзакция: (1) текущие строки `game_status` видимых игр сохраняются в новый бэкап (`reason = before_restore`, создаётся всегда, даже пустой, чтобы откат можно было откатить); (2) они удаляются; (3) вставляются строки из бэкапа ровно как были (`status`, `completed_at`, `dropped_at`, `status_changed_at`; `updated_at = now()`); (4) ротация до 10.
- Строки бэкапа по играм, которых нет в БД или которые сейчас скрыты, пропускаются без ошибки. Также пропускаются строки с некорректным содержимым (невалидный статус, дата не по статусу). Статусы скрытых игр не меняются.
- Итог: статусы видимых игр совпадают с бэкапом (игры, которых не было в бэкапе, становятся «без статуса»).
- 200:
```json
{ "ok": true, "data": { "restored": 61, "skipped": 0, "backupId": 8 } }
```
`restored`: вставлено строк; `skipped`: пропущено строк бэкапа; `backupId`: id бэкапа `before_restore` (состояние до отката).
- 404 `not_found`: бэкапа с таким id нет (в том числе вытеснен ротацией).

### 9.9a `GET /api/games/status-backups` (Фаза 8, BUG-P8-4)
Последняя копия `reason = reset_all`, чтобы UI мог предложить «Вернуть» после перезагрузки страницы. Без параметров, только чтение.
- 200:
```json
{ "ok": true, "data": { "latest": { "id": 7, "createdAt": "2026-10-27T10:00:00.000Z", "reason": "reset_all", "count": 61 } } }
```
`latest = null`, если копий `reset_all` нет (не было сброса, сбрасывать было нечего или копия вытеснена ротацией). `id` = максимальный id среди `reset_all`; `createdAt` ISO UTC; `reason` всегда `"reset_all"`; `count` = число строк в копии (длина payload, включая строки, которые откат может пропустить).
- **После отката (9.9) копия `reset_all` остаётся**: откат её не удаляет и не помечает, ответ не меняется (удаляет только ротация до 10: каждый откат добавляет `before_restore`). Это позволяет повторить откат. Скрывать «Вернуть» после успешного отката должен UI сам.
- 503 `db_unavailable`. Сессия проверяется `src/proxy.ts`.

### 9.10 Скрытые игры: где исключаются (Фаза 8)
Скрытая игра = `games.hidden_at IS NOT NULL`. Данные (снимки, трофеи, статус) не удаляются, синк продолжает их обновлять; возврат (`hidden: false`) восстанавливает всё в расчётах.

| Где | Поведение для скрытых |
|---|---|
| `GET /api/games` (9.2) | исключены из `items`, `total`, `counts`, `years`; `hidden=only` отдаёт только скрытые |
| `GET /api/collection/summary` (9.3) | исключены из `totals` (игры, часы, трофеи), `counts`, `playing`, `services`, `continue` |
| `GET /api/stats` (10.1) | исключены из часов (`header.hours`, `byMonth`, оценка 1.6), жанров, `header.completed/dropped`, `finished`, `played`, `years`. Трофеи (`counts`, `byMonth`, `header.platinum`): не считаются трофеи сетов, у которых все связанные игры скрыты; сеты-сироты считаются |
| `GET /api/wrapped` (11.1) | то же, что Статистика, плюс платины: сет только скрытых игр не участвует; игра платины выбирается среди видимых (минимальный `id`) |
| `POST /api/games/status-bulk` (9.6) | скрытые id = отсутствующие (`404`, `missingIds`) |
| `POST /api/games/status-reset-all` / `status-restore` (9.8, 9.9) | работают только со статусами видимых игр; статусы скрытых не меняются |
| `PUT .../status`, `PATCH .../status-date` (9.4, 9.5) | работают (по id), `GameItem` с `hiddenAt` |
| `GET /api/sync/status` `totals`, `/api/health` (8.4, 4.3) | **не** исключаются: это диагностика синка, считает всю БД |
| Синк (8) | не читает и не пишет `hidden_at`; снимки и трофеи скрытых игр пишутся как обычно |
| `hours.firstSnapshotDate` (10.1, 11.1) | по всей БД (дата начала синка), скрытие не влияет |

## 10. Статистика (Фаза 5)

Эндпоинт под сессией (proxy, 3.4), конверт по разделу 4, только БД. БД недоступна: `503 db_unavailable`. Типы: `src/server/stats/types.ts` (только типы, во frontend через `import type`). Экран: design-system 4.11.

### 10.1 `GET /api/stats`
| Параметр | Значение | По умолчанию |
|---|---|---|
| `period` | `year \| month` | `year` |
| `year` | целое 2000..2100 | текущий год по Москве |
| `month` | целое 1..12. Обязателен при `period=month` (нет = `400`); при `period=year` игнорируется | нет |

Мусор (не число, вне диапазона, неизвестный `period`) = `400 invalid_request`. Будущие и пустые периоды допустимы (`200`, пустые блоки).

**Время.** В БД всё в UTC. Границы периода это календарные границы **Europe/Moscow** (UTC+3, без перехода на летнее время). Период `[fromUtc, toUtc)`: полночь МСК первого дня включительно, полночь МСК следующего дня после последнего исключая; например `2026-10` это `2026-09-30T21:00:00.000Z .. 2026-10-31T21:00:00.000Z`. Следствие: событие в 01:00 МСК 1 ноября (22:00 UTC 31 октября) относится к ноябрю. Даты снимков (`snapshot_date`) уже в МСК и сравниваются как строки `YYYY-MM-DD` по `from..to` включительно (1.6). Группировка по месяцам везде по МСК.

Ответ 200:
```json
{
  "ok": true,
  "data": {
    "period": {
      "type": "year", "year": 2026, "month": null,
      "from": "2026-01-01", "to": "2026-12-31",
      "fromUtc": "2025-12-31T21:00:00.000Z", "toUtc": "2026-12-31T21:00:00.000Z"
    },
    "years": [2026, 2025],
    "header": { "completed": 12, "dropped": 3, "hours": 412.4, "platinum": 7 },
    "hours": {
      "byMonth": [12.0, 10.0, 31.5, 40.2, 55.0, 38.9, 61.3, 47.7, 52.8, 85.0, null, null],
      "estimatedByMonth": [12.0, 10.0, 4.0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "estimatedHours": 26.0,
      "hasEstimate": true,
      "firstSnapshotDate": "2026-03-04",
      "periodPartial": true
    },
    "genres": {
      "hasData": true,
      "items": [ { "key": "ACTION", "label": "Экшен", "value": 14.5 } ]
    },
    "trophies": {
      "counts": { "platinum": 7, "gold": 31, "silver": 88, "bronze": 240, "total": 366 },
      "byMonth": [ { "month": 1, "platinum": 0, "gold": 2, "silver": 5, "bronze": 11, "total": 18 } ]
    },
    "finished": {
      "groups": [
        {
          "month": "2026-10", "year": 2026, "monthNumber": 10,
          "items": [ { "kind": "completed", "at": "2026-10-05T18:42:11.000Z", "game": { "...": "GameItem по 9.1" } } ]
        }
      ]
    },
    "played": {
      "games": { "17": { "...": "GameItem по 9.1, один раз на игру" } },
      "groups": [
        {
          "month": "2026-10", "year": 2026, "monthNumber": 10,
          "completed": 1, "dropped": 0,
          "items": [
            { "gameId": 17, "hours": 6.5, "estimated": false, "finished": "completed", "finishedAt": "2026-10-05T18:42:11.000Z" },
            { "gameId": 23, "hours": 12.3, "estimated": false, "finished": null, "finishedAt": null }
          ]
        }
      ]
    }
  }
}
```

| Поле | Правило |
|---|---|
| `period` | эхо разобранных параметров. `month` = `null` при `type=year`. `from`/`to` даты МСК включительно, `fromUtc`/`toUtc` ISO UTC, `toUtc` исключается |
| `years` | годы, для которых есть хоть какие-то данные (снимки, трофеи с `earned_at`, `completed_at`/`dropped_at`), по убыванию. **Текущий год МСК присутствует всегда**, даже без данных. Для переключателя `‹ 2026 ›` |
| `header.completed` / `dropped` | число игр с `status = completed` / `dropped` и `completed_at` / `dropped_at` внутри периода. Игры без даты не учитываются |
| `header.hours` | часы игр за период: реальные по формуле 1.6 **плюс оценка** до первого снимка игры (1.6; сумма по играм, до 0.1). `null`, если по периоду нет охвата снимками (см. ниже) **и** оценочных часов в периоде нет; иначе число (в том числе `0`) |
| `header.platinum` | число платиновых трофеев с `earned_at` в периоде (включая сеты-сироты), равно `trophies.counts.platinum` |
| `hours.byMonth` | всегда 12 элементов (янв..дек) **выбранного года**, даже при `period=month` (график показывает год, текущий месяц подсвечивает UI). Элемент: **полные** часы месяца (реальные + оценочные, до 0.1) или `null`. `null` только если в месяце нет ни реальных, ни оценочных часов **и** нет охвата (месяц целиком раньше `firstSnapshotDate`, целиком в будущем или снимков нет вообще). Месяц с охватом без часов это `0`. Месяц, в котором снимки начались посреди месяца, это число (реальные от первого снимка, 1.6, плюс доля оценки) |
| `hours.estimatedByMonth` | всегда 12 чисел (до 0.1): оценочная часть каждого месяца `byMonth`, `0`, если оценки в месяце нет. Реальные часы месяца = `byMonth[i] - estimatedByMonth[i]` (при `byMonth[i] = null` оценка `0`). Столбец, у которого `estimatedByMonth > 0`, UI помечает как оценочный (целиком или в части) |
| `hours.estimatedHours` | оценочная часть `header.hours` за **период** (до 0.1), `0`, если оценки в периоде нет |
| `hours.hasEstimate` | `true`, если оценочные секунды в периоде `> 0` (`header.hours` содержит оценку). Оценка по графику года определяется по `estimatedByMonth` |
| `hours.firstSnapshotDate` | `min(snapshot_date)` по всей БД (`YYYY-MM-DD`, МСК) или `null`, если снимков нет. Для плашки «Часы считаются с даты первого синка (ДД.ММ.ГГГГ)» |
| `hours.periodPartial` | `true`, если `firstSnapshotDate = null` или начало периода (`from`) раньше `firstSnapshotDate`: UI показывает плашку |
| `genres.items` | топ-8 по убыванию `value` (при равенстве по `key`). `value` = сумма весов 1/N по играм, округлена до 0.1. Ключи и RU-подписи: 9.1 (нормализация и `genres_override ?? psn_genres`, 1.9); `OTHER` («Другое») это обычный жанр и участвует в топе наравне с остальными. Остальные жанры за пределами топ-8 не возвращаются |
| `genres.hasData` | `false` и `items: []`, если в периоде нет подходящих игр; UI скрывает блок |
| `trophies.counts` | трофеи с `earned = true` и `earned_at` внутри периода по типам; `total` их сумма |
| `trophies.byMonth` | всегда 12 элементов (`month` 1..12) выбранного года, нули без данных (трофеи за год полные, поэтому здесь нет `null`). Линия по месяцам; при `period=month` тоже весь год |
| `finished.groups` | **Устарело для экрана Статистики с Фазы 8** (блок «Игры месяца» строится по `played`); поле сохраняется без изменений для совместимости. Игры, завершённые (`kind: "completed"`, `at = completed_at`) и брошенные (`kind: "dropped"`, `at = dropped_at`) в периоде. Группы по месяцу МСК, месяцы по убыванию, внутри группы по `at` по убыванию, затем `lower(title)`, `id`. `month` = `"YYYY-MM"`. Пустой период: `groups: []`. `game` это `GameItem` 9.1 (для карточки как в коллекции) |
| `played.groups` | Фаза 8, блок «Игры месяца». Игра попадает в месяц `M` периода, если её секунды за `M` > 0 (реальные по снимкам 1.6 за даты месяца `M` + доля оценки 1.6 в `M`, ровно как слагаемые `hours.byMonth[M]`) **или** она завершена/брошена в `M` (`completed_at`/`dropped_at` по МСК, те же события, что `finished`). Игра повторяется в каждом таком месяце. Группы только для месяцев с хотя бы одной игрой, по убыванию `month`; при `period=month` это 0 или 1 группа, при `period=year` до 12. Пустой период: `groups: []` |
| `played.groups[].completed` / `dropped` | сколько игр группы завершено / брошено в этом месяце (`finished` = `completed` / `dropped`) |
| `played.games` | **Этап 3 (BUG-P8-3).** Словарь `GameItem` 9.1 по id игры (ключ = `String(id)`), каждая игра один раз, даже если она в нескольких месяцах. Содержит все игры из `items[]` и `excluded[]` (15.1) всех групп, лишних нет. Пустой период: `{}` |
| `played.groups[].items[]` | `gameId`: id игры, ключ в `played.games` (поля `game` в элементе **нет**, этап 3; всегда есть в словаре).  `hours`: часы игры **за этот месяц** (реальные + оценка, до 0.1; `0` у игры, попавшей только по завершению). `estimated`: `true`, если в часах месяца есть оценочная доля. `finished`: `"completed"`/`"dropped"`, если игру завершили/бросили **в этом месяце**, иначе `null`. `finishedAt`: ISO UTC даты завершения/броска или `null` вместе с `finished` |
| `played` порядок внутри группы | сначала `finished != null` по `finishedAt` по убыванию, затем остальные по секундам месяца по убыванию, затем `lower(title)`, `id` |

Сумма `items[].hours` группы может отличаться от `hours.byMonth` на десятые доли из-за округления по играм. Расчёт выполняется в коде по уже загруженным снимкам года (без запросов на игру/месяц); карточки `GameItem` грузятся одним запросом.

**Скрытые игры** (9.10) исключены из всех блоков; трофеи сетов только скрытых игр не считаются.

**Какие игры идут в жанры.** Игры, в которые играли в периоде (часы по 1.6 **с учётом оценки** > 0: игра с оценочными часами в периоде считается сыгранной) плюс игры, пройденные/брошенные в периоде (`completed_at`/`dropped_at` в периоде). Каждая игра считается один раз, вес её жанров суммарно 1. Для периодов до первого синка в жанрах будут игры с оценочными часами в этих месяцах и пройденные/брошенные игры.

**Охват часов периода.** Период «имеет охват», если `firstSnapshotDate` не `null`, `to >= firstSnapshotDate` и `from <=` сегодня (МСК). Без охвата и без оценочных часов в периоде `header.hours = null`; оценочные часы без охвата дают число (оценка не требует снимков в периоде).

**Оценка (1.6) и признаки.** `firstSnapshotDate` и `periodPartial` сохраняются как были: плашка «часы считаются с даты первого синка» относится к реальным часам. При `hasEstimate` или `estimatedByMonth` с ненулевыми значениями UI дополнительно помечает часы как оценку. `years` включает годы, в которые попадает хотя бы одна доля оценки.

**Период без данных.** Не ошибка: `200`, `header` с нулями и `hours: null` (если нет охвата и оценки), `genres: { hasData: false, items: [] }`, `trophies.counts` нули и 12 нулевых месяцев, `finished.groups: []`, `hours.byMonth` из `null` (кроме месяцев с оценкой), `estimatedByMonth` из нулей, `estimatedHours: 0`, `hasEstimate: false`.

**Что не учитывается.** Трофеи с `earned = true`, но `earned_at = NULL` (PSN не отдал дату) не попадают ни в какой период (ни в счётчики, ни в линию). Жанры по трофеям не считаются.


## 11. Итоги года (Фаза 6)

Эндпоинт под сессией (proxy, 3.4), конверт по разделу 4, только БД. БД недоступна: `503 db_unavailable`. Типы: `src/server/wrapped/types.ts` (только типы, во frontend через `import type`). Экран: design-system 4.12. Все расчёты переиспользуют модули `src/server/stats/` (формула часов 1.6, трофеи по `earned_at`, жанры 1.9), расхождений со Статистикой за тот же год быть не должно. Скрытые игры (9.10) исключаются так же, как в Статистике.

### 11.1 `GET /api/wrapped`
| Параметр | Значение | По умолчанию |
|---|---|---|
| `year` | целое 2000..2100 | текущий год по Москве |

Мусор (не число, вне диапазона, пустая строка трактуется как отсутствие) = `400 invalid_request`. Будущие и пустые годы допустимы (`200`, `mode: "empty"`). Границы года: календарный год **Europe/Moscow** (как в 10.1): `[fromUtc, toUtc)`, даты снимков сравниваются строками `from..to`.

Ответ 200 (`mode: "story"`):
```json
{
  "ok": true,
  "data": {
    "year": 2026,
    "mode": "story",
    "period": { "from": "2026-01-01", "to": "2026-12-31", "fromUtc": "2025-12-31T21:00:00.000Z", "toUtc": "2026-12-31T21:00:00.000Z" },
    "years": [ { "year": 2026, "hasData": true }, { "year": 2025, "hasData": false } ],
    "profile": { "onlineId": "Artem_PS" },
    "firstSnapshotDate": "2026-03-04",
    "periodPartial": true,
    "slides": ["start", "hours", "topGames", "finished", "trophies", "genres", "longestGame", "final"],
    "hours": {
      "hasData": true, "total": 412.4, "days": 17.2,
      "byMonth": [12.0, 10.0, 31.5, 40.2, 55.0, 38.9, 61.3, 47.7, 52.8, 85.0, null, null],
      "estimatedByMonth": [12.0, 10.0, 4.0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "estimatedHours": 26.0,
      "hasEstimate": true,
      "topMonth": { "month": 10, "hours": 85.0 }
    },
    "topGames": {
      "hasData": true,
      "items": [ { "rank": 1, "seconds": 101853, "hours": 28.3, "estimated": false, "game": { "...": "GameItem по 9.1" } } ]
    },
    "finished": {
      "hasData": true,
      "completed": { "count": 12, "items": [ { "at": "2026-10-05T18:42:11.000Z", "game": { "...": "GameItem" } } ] },
      "dropped":   { "count": 3,  "items": [ { "at": "2026-08-01T10:00:00.000Z", "game": { "...": "GameItem" } } ] },
      "busiestMonth": { "month": 10, "count": 4 }
    },
    "trophies": {
      "hasData": true,
      "counts": { "platinum": 7, "gold": 31, "silver": 88, "bronze": 240, "total": 366 },
      "platinum": {
        "first":  { "at": "2026-01-12T20:00:00.000Z", "name": "Платина", "earnedRate": 4.3, "rarity": 1, "setName": "Horizon", "game": { "...": "GameItem" } },
        "last":   { "...": "тот же формат" },
        "rarest": { "...": "тот же формат" }
      }
    },
    "genres": { "hasData": true, "items": [ { "key": "ACTION", "label": "Экшен", "value": 14.5 } ] },
    "longestGame": { "hasData": true, "seconds": 101853, "hours": 28.3, "estimated": false, "playCount": 19, "game": { "...": "GameItem" } },
    "emptyState": null
  }
}
```

Ответ 200 для года без данных (`mode: "empty"`):
```json
{ "year": 2025, "mode": "empty", "slides": ["empty"], "emptyState": { "syncStartedOn": "2026-03-04" },
  "hours": { "hasData": false, "total": null, "days": null, "byMonth": [null x12], "estimatedByMonth": [0 x12], "estimatedHours": 0, "hasEstimate": false, "topMonth": null },
  "topGames": { "hasData": false, "items": [] },
  "finished": { "hasData": false, "completed": { "count": 0, "items": [] }, "dropped": { "count": 0, "items": [] }, "busiestMonth": null },
  "trophies": { "hasData": false, "counts": { "platinum": 0, "gold": 0, "silver": 0, "bronze": 0, "total": 0 }, "platinum": { "first": null, "last": null, "rarest": null } },
  "genres": { "hasData": false, "items": [] },
  "longestGame": { "hasData": false, "seconds": 0, "hours": 0, "estimated": false, "playCount": 0, "game": null } }
```
Блоки в `empty` присутствуют всегда и пустые (форма ответа не меняется, UI не проверяет на undefined). `period`, `years`, `profile`, `firstSnapshotDate`, `periodPartial` тоже присутствуют.

| Поле | Правило |
|---|---|
| `mode` | `empty`, если одновременно: нет часов (`hours.hasData = false`), нет трофеев (`trophies.counts.total = 0`), нет пройденных/брошенных (`finished.completed.count + dropped.count = 0`). Иначе `story` |
| `slides` | упорядоченный список слайдов, которые UI должен показать, сегментов прогресса ровно столько. Идентификаторы в порядке 4.12: `start`, `hours`, `topGames`, `finished`, `trophies`, `genres`, `longestGame`, `final`. `start` и `final` всегда в `story`; остальные только при `hasData = true` своего блока. В `empty` ровно `["empty"]` (без автоперехода, кнопка «Закрыть»). Случай «нет часов, но есть трофеи» даёт `["start","trophies","final"]` (+`finished`/`genres`, если есть данные): `hours`, `topGames`, `longestGame` выпадают сами, потому что у них `hasData = false` |
| `years` | `{year, hasData}[]` по убыванию, для карточек выбора года. Текущий год МСК присутствует всегда. `hasData = false` приглушает карточку («нет данных»). Признак приближённый: год имеет прирост часов между соседними снимками, долю оценочных часов (1.6), трофеи с `earned_at`, `completed_at` или `dropped_at` в этом году. Окончательное решение показывает `mode` ответа за выбранный год |
| `profile.onlineId` | `PSN_TARGET_ONLINE_ID` из env или `null`. Аватара в БД нет (синк его не сохраняет), поэтому слайд «Старт» рисует инициал/плейсхолдер. Токены и NPSSO в ответ не попадают |
| `firstSnapshotDate` / `periodPartial` | как в 10.1: `min(snapshot_date)` по БД или `null`; `periodPartial = true`, если `firstSnapshotDate = null` или `from` года раньше него. Плашка слайда «Часы»: «часы с даты первого синка (ДД.ММ.ГГГГ)» показывается при `hours.hasData && periodPartial` |
| `emptyState.syncStartedOn` | в `empty`: `firstSnapshotDate` (дата МСК `YYYY-MM-DD`; UI формат ДД.ММ.ГГГГ); `null`, если синка не было, тогда UI убирает строку «Синк начался…». В `story` всегда `null` |
| `hours.hasData` | `total > 0`, где `total` включает оценку (1.6) |
| `hours.total` | часы за год: реальные по 1.6 плюс оценка (сумма по играм, до 0.1), `null`, если нет охвата снимками и нет оценочных часов в году. `days = round(total / 24, 1)` для «≈ N дней», `null` вместе с `total` |
| `hours.byMonth` | 12 элементов, правила как в 10.1 (полные часы месяца с оценкой; `null` нет ни охвата, ни оценки). `topMonth` = месяц (1..12) с максимумом часов (с оценкой); при равенстве более ранний; `null`, если `hasData = false` |
| `hours.estimatedByMonth` / `estimatedHours` / `hasEstimate` | как `hours.estimatedByMonth` / `estimatedHours` / `hasEstimate` в 10.1 (период = год). UI помечает оценку на слайде «Часы» |
| `topGames.items` | до 5 игр с положительными часами за год (реальные + оценка, 1.6), по убыванию `seconds`; при равенстве по `lower(title)`, затем `id`. `rank` 1..5, `seconds` и `hours` это часы **за год** (не суммарные `game.hours`), `estimated` = `true`, если в этих часах есть оценочная часть (UI пишет «≈»), `game` это `GameItem` 9.1 (обложка, название) |
| `finished.completed` / `dropped` | `count` = число игр со `status = completed` / `dropped` и датой в году (как `header` в 10.1); `items` = все такие игры по `at` по убыванию, затем `lower(title)`, `id` (UI берёт первые 4 и 3 обложки). `at` это `completed_at`/`dropped_at` |
| `finished.busiestMonth` | месяц (1..12) с наибольшим числом завершённых и брошенных вместе и это число; при равенстве более ранний; `null`, если `hasData = false`. `hasData = completed.count + dropped.count > 0` |
| `trophies.counts` | как `trophies.counts` в 10.1 за год. `hasData = total > 0` |
| `trophies.platinum` | `first` и `last` это самая ранняя и самая поздняя платина года по `earned_at` (при одной платине совпадают), `rarest` это платина с минимальным `earnedRate` (ничья: более ранняя; платины без `earnedRate` не участвуют). Любое из трёх `null`, если подходящих нет. Объект: `at` (ISO), `name` (`trophies.name` или `null`), `earnedRate` (число % или `null`), `rarity` (0..3 или `null`), `setName` (`trophy_sets.name`), `game`: `GameItem` игры сета (при нескольких играх на сет минимальный `id`) или `null` для сета-сироты |
| `genres` | топ-3 (10.1: те же правила выбора игр, в том числе игры с оценочными часами, и веса 1/N, меняется только размер топа). `hasData = items.length > 0` |
| `longestGame` | игра №1 из `topGames` (тот же порядок, та же ничья, `estimated` как у неё). `seconds`/`hours` за год, `playCount` = `game.playCount` (общее число запусков игры за всё время, PSN не отдаёт запуски по периодам). `hasData = false`, `game = null`, нули, если `topGames` пуст |

**Что не учитывается.** Трофеи без `earned_at` не попадают в год (как в 10.1). Годы до первого синка не имеют реальных часов, но имеют оценочные (1.6), если у игр с `first_played_at` в этом году есть доля оценки: слайды `hours`, `topGames`, `longestGame` строятся по ней и помечаются как оценка (`hasEstimate`, `estimated`). Если оценки нет, эти слайды пропускаются, остальное строится по трофеям и датам статусов.

## 12. Коллекция v2 (Фаза 9)

### 12.1 Схема (миграция `0003`, только добавляет)
- `games.banner_url` text null: горизонтальный арт игры для hero «Играю» и шапки окна игры. Берётся при синке из `concept.media.images` (по `type` изображения: `SIXTEEN_BY_NINE_BANNER`, `GAMEHUB_COVER_ART`, `FOUR_BY_THREE_BANNER`, `BACKGROUND`, `SCREENSHOT`; затем любое с числовыми `width > height`, если PSN их отдаст (в реальном ответе размеров нет); если нет, `null`, UI рисует размытый фон из обложки). Синк не затирает непустое значение пустым (как `image_url`, `coalesce`). Backend сначала проверяет по фикстурам `src/server/psn/__fixtures__`, какие `imageType`/размеры реально приходят, и фиксирует правило выбора в `docs/api-notes.md`.
- Таблица `psn_profile` (ровно одна строка, `id = 1` CHECK):

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | smallint PK, CHECK `id = 1` | нет | |
| `online_id` | text | нет | |
| `avatar_url` | text | да | самый крупный из `avatarUrls` |
| `trophy_level` | smallint | да | `trophySummary.level` |
| `trophy_progress` | smallint | да | `trophySummary.progress`, 0..100 до следующего уровня |
| `trophy_tier` | smallint | да | `trophySummary.tier` |
| `earned_platinum` / `earned_gold` / `earned_silver` / `earned_bronze` | integer | да | `trophySummary.earnedTrophies` |
| `updated_at` | timestamptz | нет | |

- Синк пишет профиль апсёртом после `getProfileFromUserName` (уже вызывается при старте клиента). Ошибка/отсутствие `trophySummary` или `avatarUrls` не роняет синк: поля остаются `null`/прежними. Токены в профиль не пишутся.
- Данные PSN-профиля (`avatar_url`) это внешняя ссылка на CDN PSN; UI показывает `<img>` с fallback на инициал.

### 12.2 Расширение `GameItem` (9.1)
Добавляется `"bannerUrl": string | null` (`games.banner_url`). Остальное без изменений.

### 12.3 `GET /api/collection/summary` (9.3)
Добавляется `"profile": PsnProfile | null`:
```json
{ "onlineId": "Artem_PS", "avatarUrl": "https://...", "level": 312, "levelProgress": 47, "tier": 7,
  "trophies": { "platinum": 38, "gold": 410, "silver": 1100, "bronze": 2800, "total": 4348 } }
```
`null`, если синк профиль ещё не сохранял. Любое поле, которого PSN не дал, `null`. `trophies` целиком `null`, если счётчиков нет. Это счётчики PSN-аккаунта, они могут отличаться от `totals` (включают скрытые игры и игры вне библиотеки).

### 12.4 `GET /api/wrapped` (11.1)
`profile` расширяется: `{ "onlineId": string | null, "avatarUrl": string | null }`. `onlineId`: `PSN_TARGET_ONLINE_ID` из env, а если его нет, ник из `psn_profile`; `avatarUrl` из `psn_profile`. Слайд «Старт» показывает аватар, при `null` или ошибке загрузки инициал.

### 12.5 `GET /api/games/{id}`
Детали игры для окна. Сессия, конверт 4.1. `id` не число = `400 invalid_request`, нет игры = `404 not_found`. Для чужой игры (с Фазы 20, другой `user_id`) ответ тот же `404 not_found` с тем же телом и сообщением, что и для несуществующей: `403` не используется, существование чужого id не раскрывается. Скрытая игра отдаётся (`hiddenAt` не `null`).

```json
{
  "ok": true,
  "data": {
    "game": { "...": "GameItem по 9.1 с bannerUrl" },
    "firstPlayedAt": "2024-03-01T10:00:00.000Z",
    "statusChangedAt": "2026-10-06T08:00:00.000Z",
    "trophyList": [
      { "setId": 41, "trophyId": 0, "type": "platinum", "name": "Легенда", "detail": "Получите все трофеи",
        "iconUrl": "https://...", "hidden": false, "earned": true, "earnedAt": "2026-10-05T18:42:11.000Z",
        "rarity": 0, "earnedRate": 2.4 }
    ]
  }
}
```
| Поле | Правило |
|---|---|
| `firstPlayedAt` | `games.first_played_at` ISO UTC или `null` |
| `statusChangedAt` | `game_status.status_changed_at` или `null` (нет статуса) |
| `trophyList` | трофеи всех сетов игры (1.4). `[]`, если сетов нет. Порядок по умолчанию: `setId`, `trophyId`; клиентский сорт/фильтр |
| `name` / `detail` / `iconUrl` | как в БД. Для скрытого и не полученного (`hidden && !earned`) трофея `name`, `detail` и `iconUrl` отдаются `null` (UI рисует «Скрытый трофей» и замок); для полученного значения как есть |
| `rarity` | `0..3` (PSN: 0 ультра-редкий, 1 очень редкий, 2 редкий, 3 обычный) или `null` |
| `earnedRate` | число с 2 знаками, % игроков, или `null` |
| `earnedAt` | `null`, если не получен или PSN не отдал дату |

### 12.6 Платина как фильтр
Чип «Платина» работает на клиенте по `GameItem.trophies.platinumEarned` (серверных параметров не добавляем). Пересчёт `counts` в сводке не меняется.

## 13. Статистика v2 (Фаза 10)

Изменения `GET /api/stats` (10.1), только добавления полей.

### 13.1 Жанры с играми
`genres.items[]` получает `gameIds: number[]` (id игр, давших вес жанру; порядок: секунды игры в периоде по убыванию, затем `lower(title)`, `id`; не более 50). Верхнеуровневое `genres.games: Record<string, { id, title, coverUrl }>` содержит все `gameIds` (ключ строка id). Игра с несколькими жанрами присутствует в каждом из них. Выбор игр и вес как в «Какие игры идут в жанры» (10.1).

### 13.2 Топ игр
Новый блок `top`:
```json
"top": {
  "byHours": [ { "game": { "...": "GameItem" }, "hours": 85.4, "estimated": false } ],
  "byTrophies": [ { "game": { "...": "GameItem" }, "points": 840,
                    "counts": { "platinum": 1, "gold": 5, "silver": 12, "bronze": 20, "total": 38 } } ]
}
```
| Поле | Правило |
|---|---|
| `byHours` | топ-10 игр за период по секундам (реальные по снимкам плюс оценка, те же `secondsByGame` + оценка, что в `hours`; `hours` до 0.1; `estimated = true`, если есть оценочная доля). Порядок: секунды по убыванию, `lower(title)`, `id`. Игры с 0 секунд не входят |
| `byTrophies` | топ-10 по очкам трофеев, полученным в периоде (`earned_at` внутри `[fromUtc, toUtc)`). Очки по типам: bronze 15, silver 30, gold 90, platinum 300 (очки уровня PSN). Редкость без бонуса. Порядок: очки по убыванию, `lower(title)`, `id`. Игры без трофеев в периоде не входят |
| Исключения | скрытые игры (9.10); трофеи сетов-сирот (нет игры) в `byTrophies` не учитываются (в `header`/`trophies` остаются). Трофеи без `earned_at` не считаются |
| Игра сета в `byTrophies` | трофеи сета, связанного с несколькими играми, идут игре с минимальным `id` среди видимых (как «игра платины» в 11.1). Один сгруппированный SQL-запрос на период, карточки `GameItem` топов грузятся тем же запросом, что и остальные (число запросов не зависит от числа игр) |
| Вес ответа | добавка: до 20 `GameItem` в `top` и не больше 8 x 50 коротких записей в `genres.games`; `played` не менялся (BUG-P8-3 не ухудшен) |
| Пустой период | `{ "byHours": [], "byTrophies": [] }`; `genres: { hasData: false, items: [], games: {} }` |

## 14. Доп. предложения (Фаза 15)

Только добавления полей и один новый эндпоинт. Миграций нет, схема БД (1) не меняется, новых секретов нет. Все расчёты в чистых функциях `src/server/stats/rare.ts`, `src/server/collection/platinum.ts`, `src/server/stats/activity.ts`, `src/server/collection/forgotten.ts` (Vitest), выборки отдельно. Скрытые игры (9.10) исключены везде, кроме `GET /api/games/{id}` (там прогноз считается и для скрытой игры). Число запросов не зависит от числа игр.

### 14.1 «Редкие трофеи» (15.2)
**Фаза 17.2:** по умолчанию без трофеев игр-сервисов, параметр `withService` включает их обратно (20.8).

Объект `RareTrophy` (общий для Статистики и Итогов). Карточка игры короткая (как `genres.games` в 13.1), не `GameItem`: не утяжеляет `/api/stats` (BUG-P8-3).
```json
{ "setId": 41, "trophyId": 12, "type": "gold", "name": "Без единой царапины", "detail": "Пройдите на высоком уровне сложности",
  "iconUrl": "https://...", "earnedAt": "2026-03-02T19:10:00.000Z", "earnedRate": 0.8, "rarity": 0, "setName": "Horizon",
  "game": { "id": 17, "title": "Horizon Forbidden West", "coverUrl": "https://..." } }
```
| Поле | Правило |
|---|---|
| Отбор | `trophies.earned = true` и `earned_rate IS NOT NULL` (без процента редкость не сравнить; `rarity` 0..3 слишком грубая для топа). Сет учитывается по `trophySetCounted` (9.10: сеты только скрытых игр не участвуют, сироты участвуют) |
| Порядок | `earned_rate` по возрастанию, затем `earned_at` по возрастанию (`NULL` в конце), затем `setId`, `trophyId`. Все типы трофеев, включая платину |
| Лимит | 5, `LIMIT 5` в SQL (одна выборка на список) |
| `name` / `detail` / `iconUrl` | как в БД (трофей получен, маскировки 12.5 нет) |
| `earnedAt` | ISO UTC или `null` (PSN не отдал дату; такие трофеи бывают только в списке «за всё время») |
| `earnedRate` | число % с 2 знаками; `rarity` 0..3 или `null` |
| `game` | видимая игра сета с минимальным `id` (как «игра сета» в 11.1, 13.2) или `null` для сета-сироты |

Где отдаётся:
- `GET /api/stats` (10.1): новый блок `"rareTrophies": { "period": RareTrophy[], "allTime": RareTrophy[] }`. `period`: `earned_at` внутри `[fromUtc, toUtc)` выбранного периода (год или месяц). `allTime`: без ограничения по дате, включая трофеи без `earned_at`. Не зависит от `period` в запросе. Пустой период: `period: []`. Добавка к весу: не больше 10 коротких записей.
- `GET /api/wrapped` (11.1): `trophies.rare: RareTrophy[]`, отбор `earned_at` внутри года. В `mode: "empty"` `[]`. Список `slides` **не меняется** (новый id слайда не добавляется, чтобы не ломать текущий UI): frontend показывает список на слайде `trophies` или добавляет слайд у себя.

### 14.2 Прогноз платины (15.3)
Объект `PlatinumForecast`:
```json
{ "setId": 41, "required": 54, "earned": 49, "progress": 91,
  "remaining": { "gold": 1, "silver": 1, "bronze": 3, "total": 5 },
  "remainingHidden": 1,
  "avgEarnedRate": 12.35, "minEarnedRate": 1.2, "ratesKnown": 5,
  "platinumEarnedRate": 4.3 }
```
| Поле | Правило |
|---|---|
| Когда `null` | у игры нет трофеев в таблице `trophies` (нет сета или детали сета ещё не загружены синком), ни в одном сете игры нет платины, или **хоть в одном сете игры платина получена** (согласовано с `GameItem.trophies.platinumEarned`) |
| Какой сет | среди сетов игры с неполученной платиной: максимальный `progress` (точное отношение), при равенстве меньший `setId`. Сеты без платины не участвуют |
| `required` / `earned` | число неплатиновых трофеев сета / из них полученных |
| `progress` | целое 0..100: `floor(earned / required * 100)` (floor, чтобы 99.6% не выглядели как 100%); `required = 0` даёт `0` |
| `remaining` | неполученные неплатиновые по типам, `total` их сумма |
| `remainingHidden` | сколько из оставшихся скрытые (`hidden`; название и иконку UI не знает, 12.5) |
| `avgEarnedRate` / `minEarnedRate` | среднее арифметическое и минимум `earned_rate` оставшихся (2 знака). `null`, если ни у одного оставшегося нет процента. `ratesKnown` = у скольких оставшихся процент есть |
| `platinumEarnedRate` | `earned_rate` самой платины сета или `null` |

**Ограничение данных PSN (снято в Фазе 15, 15.3).** Колонка `trophies.group_id` есть (миграция `0005`): DLC отделены от базовой группы, прогноз считается по `default`/`NULL`. До перезагрузки сета (`group_id IS NULL`) прогноз приблизительный (`approximate`).

Где отдаётся:
- `GET /api/games/{id}` (12.5): новое поле `"platinumForecast": PlatinumForecast | null`. Считается из уже загруженного `trophyList` (без нового запроса). Скрытая игра тоже получает прогноз.
- `GET /api/collection/summary` (9.3): новый блок `"nearPlatinum": [ { "game": GameItem, "forecast": PlatinumForecast } ]`, до 5 элементов. Место выбрано в сводке Коллекции, а не в Статистике: прогноз не зависит от периода, а `/api/stats` и так тяжёлый (P8-3). Отбор: видимые игры, статус не `dropped` (без статуса тоже участвуют), `forecast != null`, `forecast.earned > 0`. Порядок: `progress` по точному отношению по убыванию, `remaining.total` по возрастанию, `lower(title)`, `id`. Одна сгруппированная выборка по `(игра, сет)` + карточки тем же запросом `GameItem`. Пусто: `[]`.

### 14.3 Стрик и тепловая карта (15.4): `GET /api/stats/activity`
Отдельный эндпоинт, а не поле `/api/stats`: стрики считаются по всей истории снимков (не по периоду), массив дней года это 365 записей, а `/api/stats` уже тяжёлый (P8-3). Экран может грузить его лениво. Сессия (proxy, 3.4), конверт 4.1, БД недоступна: `503 db_unavailable`.

| Параметр | Значение | По умолчанию |
|---|---|---|
| `year` | целое 2000..2100 (пустая строка = нет параметра), иначе `400 invalid_request` | текущий год МСК |

```json
{ "ok": true, "data": {
  "year": 2026, "today": "2026-10-28", "firstSnapshotDate": "2026-10-20",
  "days": [ { "date": "2026-01-01", "minutes": null }, { "date": "2026-10-21", "minutes": 95 }, { "date": "2026-10-22", "minutes": 0 } ],
  "totals": { "playedDays": 5, "knownDays": 7, "minutes": 610, "maxMinutes": 180 },
  "streak": {
    "current":    { "days": 3, "from": "2026-10-25", "to": "2026-10-27", "hasGaps": false },
    "best":       { "days": 4, "from": "2026-10-21", "to": "2026-10-24", "hasGaps": true },
    "bestInYear": { "days": 4, "from": "2026-10-21", "to": "2026-10-24", "hasGaps": true }
  }
} }
```
| Поле | Правило |
|---|---|
| Секунды дня `D` | сумма по видимым играм положительных дельт `play_duration_seconds(D) - play_duration_seconds(предыдущий снимок этой игры)`. Отрицательные дельты = 0 (как 1.6). Первый снимок игры дельты не даёт (как база в 1.6, без оценки): день, когда новая игра впервые попала в синк, её время не получает. Если синк пропустил дни, вся дельта относится к дню следующего снимка |
| Известный день | дата, где хотя бы у одного снимка есть предыдущий снимок той же игры (в SQL `count(lag) > 0`). Поэтому сам `firstSnapshotDate` всегда неизвестен (у всех игр это первый снимок) |
| `days` | все дни года (365/366) по возрастанию даты МСК. `minutes`: `null` = день неизвестен (раньше первого снимка, в первый день синка, пропуск синка, будущее, сегодня до снимка); `0` = снимок есть, игры не было; иначе `max(1, round(sec / 60))` (любая игра даёт минимум 1) |
| `totals` | по дням выбранного года: `playedDays` (`minutes > 0`), `knownDays` (`minutes != null`), `minutes` (сумма), `maxMinutes` (максимум, `0` без данных) для шкалы карты |
| Игровой день | известный день с секундами > 0 |
| Правило стрика | серия игровых дней подряд по календарю МСК. Неизвестный день серию **не рвёт и не удлиняет** (пропуск синка); серия, прошедшая через неизвестные дни, получает `hasGaps: true`. Рвёт серию только известный день без игры. Сегодня серию не рвёт никогда (день не кончился, cron в 23:00 МСК) |
| `streak.current` | серия, жива на сегодня: от сегодня назад пропускаются сегодня (если не игровой) и неизвестные дни; если первый встреченный известный день игровой, считается его серия, иначе `days: 0` |
| `streak.best` | самая длинная серия за всю историю снимков (при равенстве более поздняя). Не зависит от `year` |
| `streak.bestInYear` | самая длинная серия, считая только игровые дни внутри года (серия через 1 января режется по границе года МСК) |
| Пусто | `days: 0, from: null, to: null, hasGaps: false`. Нет снимков: все `minutes = null`, нули в `totals`, `firstSnapshotDate: null` |

**Честные ограничения.** Дни до первого синка неизвестны (PSN отдаёт только суммарное время). Снимок cron идёт в 23:00..23:59 МСК: игра после него уходит в следующий день. Оценка часов 1.6 здесь не используется (она помесячная, по дням её нет). Сумма секунд дней месяца равна реальным часам 1.6 этого месяца (та же база: предыдущий снимок игры, первый снимок игры дельты не даёт); `minutes` расходятся с ними только на округление по дням (и если PSN уменьшал время игры: здесь обнуляется каждая отрицательная дельта дня, в 1.6 только итог периода).

### 14.4 «Забытые игры» (15.5)
Забытая игра: видимая (`hidden_at IS NULL`), без статуса (нет строки `game_status`), `play_duration_seconds > 0`, `last_played_at IS NOT NULL` и `last_played_at < now - 90 дней` (момент, не календарный день). Игры без даты запуска забытыми не считаются.

Экран Разбора (`/triage`) берёт очередь из `GET /api/games?status=none` (9.2). Изменения 9.2:
- Новый параметр `forgotten`: `only` = только забытые игры (сочетается с `q`, `year`, `status`, `sort`, `limit`/`offset` через И; с `hidden=only` даёт пустой список, потому что забытые всегда видимые). Нет параметра или пустая строка = без фильтра. Другое значение = `400`. `counts` и `years` от `forgotten` не зависят (как от `status`).
- Новое поле ответа `forgottenCount: number`: число забытых игр во всей коллекции, без учёта `q`/`year`/`status`/`hidden`/`forgotten`. Для подписи группы «Забытые (N)» в Разборе.
- Флаг для отдельной карточки очереди frontend вычисляет сам по `GameItem` (`status === null && playSeconds > 0 && lastPlayedAt && Date.now() - lastPlayedAt > 90 сут`), поле в `GameItem` не добавляется.

## 15. Этап 2: backend-блок (9.1 п.4, 15.1, 15.3, 15.6)

Только добавления. Две миграции, обе только добавляют (данные не теряются): `0004_month_exclusions` (15.1) и `0005_tint_trophy_groups_notify` (15.2, 15.3, 15.4). Все новые поля ответов необязательны для текущего UI (старый UI их игнорирует). Типы: `src/server/collection/types.ts`, `src/server/stats/types.ts`.

### 15.1 «Убрать игру из месяца» (Фаза 9.1 п.4)

**Таблица `game_month_exclusions`** (миграция `0004`):

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `game_id` | integer FK -> `games.id` ON DELETE CASCADE | нет | |
| `month` | text | нет | месяц МСК `YYYY-MM`. CHECK `month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'` |
| `created_at` | timestamptz | нет, default now() | |

PK составной `(game_id, month)`. Синк таблицу не трогает.

**Что значит исключение (решение Артёма):**
- **Оценочные часы (1.6)** игры перераспределяются по остальным месяцам её диапазона: `S0` делится поровну на `n - k` месяцев (`n` длина диапазона, `k` число исключённых месяцев диапазона), остаток `S0 mod (n - k)` в последний оставшийся месяц; сумма долей равна `S0`. Исключённый месяц получает 0 оценки. Исключения вне диапазона на оценку не влияют.
- **Реальные часы по снимкам не двигаются**: `hours.byMonth`, `header.hours`, `top`, жанры считают их как раньше. Для них исключение только убирает игру из списка «Игры месяца» этого месяца.
- **Диапазон из одного месяца** (перераспределять некуда): исключение разрешено, оценочная часть игры из часов выпадает целиком (`hours.byMonth`, `header.hours`, `top`, жанры, Итоги теряют `S0` этой игры); реальные часы не трогаются. API сообщает это в ответе (`estimateDropped: true`).
- **Диапазон длиннее одного месяца**: исключить последний неисключённый месяц запрещено (409 `month_exclusion_conflict`). Если такая комбинация всё же оказалась в БД (диапазон изменился после синка), расчёт игнорирует исключения этой игры для оценки (часы не пропадают).
- `header.completed` / `header.dropped` не меняются (считаются по дате статуса).
- Итоги года и `top`/жанры используют те же оценочные входы, поэтому согласованы со Статистикой автоматически.
- Скрытые игры (9.10) в оценку не входят; их исключения хранятся, но не действуют.

**`PUT /api/games/{id}/month-exclusions`**. Сессия, `Content-Type: application/json` и `Origin` по 3.4. Тело `{"month": "2026-03", "excluded": true}`: `month` строка `YYYY-MM` (год 2000..2100), `excluded` boolean, оба ключа обязательны. Идемпотентен.
- 200: `{"ok":true,"data":{"gameId":17,"month":"2026-03","excluded":true,"excludedMonths":["2026-03"],"redistributed":true,"estimateDropped":false}}`. `excludedMonths` все исключённые месяцы игры по возрастанию. `redistributed: true`: при `excluded: true` оценочные часы месяца перешли в остальные месяцы диапазона (длина диапазона больше 1 и месяц в нём). `estimateDropped: true`: диапазон из одного месяца, оценка выпала. Оба `false`: у игры в этом месяце оценки не было (только реальные часы / вне диапазона) или это возврат (`excluded: false`). UI по этим флагам пишет честный тост.
- 400 `invalid_request`: id, тело, `month`, Content-Type/Origin. 404 `not_found`: игры нет.
- **409 `month_exclusion_conflict`**: попытка исключить последний неисключённый месяц диапазона оценки длиннее одного месяца. `details: {"gameId":17,"month":"2026-03","rangeMonths":["2026-03","2026-04"],"excludedMonths":["2026-04"]}`. Сообщение: «Нельзя убрать игру из всех месяцев: часы некуда перераспределить.» Возврат (`excluded: false`) никогда не даёт 409. Игры без оценки (нет `first_played_at`, `S0 = 0` и т.д., 1.6) исключаются из любого месяца без ограничений.

**Изменения `GET /api/stats` (10.1)**: каждый `played.groups[].items[]` и `excluded[]` получает `hoursReal` (измеренная часть `hours`, до 0.1) и `hoursEstimated` (оценочная часть, до 0.1); `hours` их сумма с точностью до округления, `estimated = hoursEstimated > 0`. `hoursReal > 0` = у игры в месяце есть измеренные часы. у каждой группы `played.groups[]` появляется `excluded: PlayedItem[]` (всегда массив). Исключённая игра **не входит** в `items` и не учитывается в `completed`/`dropped` группы. В `excluded` попадают игры, исключённые из этого месяца, при условии что они в нём присутствовали бы: реальные секунды месяца > 0, или месяц входит в диапазон оценки (без учёта исключений), или игра завершена/брошена в этом месяце. Форма элемента та же (`gameId` вместо `game` с этапа 3, `hours`, `hoursReal`, `hoursEstimated`, `estimated`, `finished`, `finishedAt`), `hours` = только реальные часы месяца (оценка исключена, `estimated: false`). Порядок: `lower(title)`, `id`. Группа выводится, если непусты `items` или `excluded` (поэтому группа может иметь `items: []`). Фронтенд показывает `excluded` свёрнуто с действием «Вернуть в месяц» (`excluded: false`). Число запросов `/api/stats` не меняется по сравнению с числом при отсутствии исключений плюс один фиксированный запрос исключений; вес ответа растёт только на число исключений.

### 15.2 Цвет акцента из обложки (15.1)

**Схема** (миграция `0005`): `games.tint` text null, CHECK `tint ~ '^#[0-9a-f]{6}$'`; `games.tint_checked_at` timestamptz null (когда последний раз пытались посчитать; без неё неудачные обложки перебирались бы в каждом синке и занимали очередь).

**API**: `GameItem.tint: string | null` (`#rrggbb` строчными или `null`). `null` значит «нет цвета»: фронтенд берёт акцент темы. В типе поле необязательное (как `hiddenAt`), сервер присылает всегда.

**Когда считается.** Не отдельная фаза (число шагов `progress.steps` в 8.4 не меняется), а шаг в конце звена, которое успешно прошло все фазы (`status = success`), в пределах оставшегося бюджета времени (останавливается, когда осталось меньше 3 с). Выборка: игры с `tint IS NULL`, у которых есть https-источник и (`tint_checked_at IS NULL` или старше 7 дней); порядок `last_played_at desc nulls last, id`; не больше 120 игр за звено, 6 параллельно. Первый синк (214 игр) закрывает всё за 1-2 суточных запуска.
- Источник: `image_url` (обложка), иначе `banner_url`. Только `https:` (как BUG-P9-2), хост не `localhost` и не IP-литерал, таймаут 8 с, не больше 4 МБ, `Content-Type: image/*`. Загрузка байтов лежит в `src/server/psn/image.ts`.
- Если у игры сменился `image_url` (апсерт синка видит другое непустое значение), `tint` и `tint_checked_at` обнуляются и цвет считается заново.
- Ошибка (сеть, не картинка, sharp не загрузился, серое изображение без цвета) не роняет синк: `tint` остаётся `null`, `tint_checked_at = now`, в `sync_runs.warnings` одно предупреждение `tint_failed` со счётчиком. Если не загрузился сам `sharp`: предупреждение `tint_unavailable`, `tint_checked_at` не пишется (не «сжигаем» очередь).

**Алгоритм** (`src/server/tint/pick.ts`, чистая функция + Vitest): картинка уменьшается до 32x32 RGB. Пиксели с насыщенностью `s < 0.30` или яркостью `v < 0.25` отбрасываются (серое, чёрное, белое, фон). Остальные раскладываются по 12 секторам оттенка (по 30 градусов), вес пикселя `s * v`. Побеждает сектор с наибольшим суммарным весом; если в нём меньше 5% пикселей (51 из 1024) результат `null`. Цвет = взвешенное среднее сектора; затем в HSL `s` ограничивается диапазоном [0.50, 0.85], `l` диапазоном [0.50, 0.62], чтобы акцент читался на тёмных темах. Это значение для `--tint`; адаптацию под светлую тему и контраст делает frontend/designer.

**Зависимость `sharp`** (^0.35): уже стоит в `node_modules` как опциональная зависимость Next.js (оптимизация изображений на Vercel), поэтому в рантайме Vercel он гарантированно работает (готовые бинарники под linux x64, сборка не нужна); добавляется в `dependencies` явно. Импортируется динамически (`await import('sharp')`) только в шаге tint, поэтому сбой бинарника не ломает остальной синк. Бесплатно, внешних сервисов нет. Альтернативы отвергнуты: чистый JS (`jimp`, `pngjs`) медленнее и без JPEG, `node-vibrant` тянет `jimp`, canvas на Vercel тяжёлый.

### 15.3 DLC в прогнозе платины (риск из 14.2)

**Схема** (миграция `0005`): `trophies.group_id` text null. Значение PSN `trophyGroupId`: `default` базовая игра, `001`, `002`... DLC. `NULL` значит «ещё не загружено/неизвестно».

**Синк**: `trophyGroupId` приходит только в определениях трофеев (`getTitleTrophies`, тип `TitleThinTrophy`); в списке полученных (`getUserTrophiesEarnedForTitle`, `UserThinTrophy`) поля нет. Поэтому сет с `group_id IS NULL` перезагружается с обоими запросами (полученные + определения); нет поля в ответе: остаётся `NULL`. Апсерт `group_id = coalesce(excluded.group_id, trophies.group_id)`. Для уже загруженных трофеев сет считается устаревшим (8.1), если в нём есть строка `trophies` с `group_id IS NULL` **и** `trophies_synced_at` старше суток. Перезагрузка идёт обычной фазой `trophies`: батчами по сетам, в бюджете звена, с продолжением по 8.2, идемпотентно (апсерт). Условие «старше суток» не даёт перезагружать сет в каждом синке, если строки с `NULL` остались от трофеев, которых PSN уже не отдаёт. До завершения перезагрузки все такие сеты считаются приблизительными.

**Расчёт прогноза платины (14.2) и «ближе к платине» по базовой группе.** В `required`, `earned`, `remaining`, `remainingHidden`, `avgEarnedRate`, `minEarnedRate`, `ratesKnown` и в выборе сета (максимальный точный прогресс) участвуют только неплатиновые трофеи с `group_id = 'default'` **или `NULL`**. Трофеи DLC (`group_id` не `default` и не `NULL`) выносятся отдельно. Платина считается по сету целиком (платины в DLC не бывает).

Новые поля `PlatinumForecast` (необязательные в типе, сервер присылает всегда):
| Поле | Правило |
|---|---|
| `approximate` | `true`, если среди неплатиновых трофеев выбранного сета есть строки с `group_id IS NULL`: DLC ещё не отделены и могут быть учтены в базовой группе. Фронтенд показывает «приблизительно». После перезагрузки `false` |
| `dlc` | `null`, если у выбранного сета нет трофеев DLC. Иначе `{"required": 12, "earned": 5, "remaining": 7}` (неплатиновые трофеи групп кроме `default`). Для платины не нужны, показываются отдельной пометкой |

Новое поле `GameTrophyItem.groupId: string | null` (12.5): значение `trophies.group_id` (в типе необязательное).

`GameItem.trophies` (9.1: `earned`/`defined`/`progress`/`byType`) остаётся суммой по всем группам сета (как показывает PSN, источник `trophy_sets`); «прогресс к платине» это `PlatinumForecast.progress`. Ограничение 14.2 («в БД нет `trophyGroupId`») снято этим разделом.

**Фаза 36 (без миграции, `0026` не нужна: `group_id` из этого раздела уже покрывает задачу).** «Подскажи» (18.3, сигнал `platinum_close`) раньше брал прогресс из сумм `trophy_sets` целиком, включая DLC. Теперь `loadCandidates` вычитает из сумм `earned`/`total` трофеи DLC игры (`trophies.group_id` не `default` и не `NULL`, фильтр `user_id`), т.е. прогресс идёт по базовой группе, как в «ближе к платине» (`platinum-query.ts`, `isBaseGroup`). Игра с пройденной базой и невыполненным DLC получает полный `platinum_close`. Штраф «DLC-хвост» (x0.5) удалён вместе с полем `Candidate.trophy.dlcTail` и подписью «есть DLC-хвост». Платина не вычитается из сумм даже при `group_id` не `default` (единообразно с `platinum-query.ts`). Сет с `group_id IS NULL` считается как раньше: все его трофеи в базе (DLC не отделены), поведение меняется после добора `group_id` синком. Формат ответа API не менялся.

### 15.4 Предупреждение о протухании NPSSO в Telegram (15.6)

**Переменные** (раздел 5, обе необязательные): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Не заданы обе: модуль ничего не делает (ни запросов, ни записей в БД, ни ошибок). Токен не логируется и не попадает в тексты ошибок.

**Модуль** `src/server/notify/telegram.ts`: `sendTelegram(text)` через `POST https://api.telegram.org/bot<token>/sendMessage` (JSON `{chat_id, text, disable_web_page_preview: true}`, таймаут 8 с). Любая ошибка (сеть, не 2xx, исключение) проглатывается и возвращает `false`; в `console.error` пишется только короткий код без URL и токена. Проверки и дедуп: `notifyAfterSync` (см. ниже).

**Ссылки на игры (Фаза 18).** Необязательная переменная `APP_ORIGIN` (публичный адрес сайта, `https://<домен>`; нормализуется до origin, не http/https или пусто = не задана). Сообщение, где упоминается игра из библиотеки, получает абсолютную ссылку `{APP_ORIGIN}/?game=<id>` (`gameLink` / `gameLine` в `telegram.ts`, `getAppOrigin` в `env.ts`). Не задана `APP_ORIGIN` или у игры нет записи в библиотеке (нет `id`): ссылки нет, текст без изменений, ничего не падает. Сейчас ни один из существующих текстов (NPSSO, синк, бэкап) игру не называет, поэтому хелперы подключаются при появлении таких сообщений. `VERCEL_URL` не используется (у preview-деплоя другой адрес).

**Таблица `notify_log`** (миграция `0005`): `kind` text PK, `last_sent_at` timestamptz not null, `sent_on` date not null (дата МСК последней успешной отправки). Дедуп: сообщение типа `kind` не чаще одного раза за календарные сутки МСК (`sent_on = сегодня` пропускает отправку). Выбран календарный день, а не «24 часа»: cron на Hobby плавает в пределах часа, скользящее окно иногда пропускало бы день. Запись пишется только после успешной отправки (недоставленное сообщение будет повторено при следующей проверке).

**Триггеры** (проверяются в порядке приоритета, шлётся не больше одного сообщения за проверку; если сообщение высшего сработавшего триггера уже было отправлено сегодня, остальные не отправляются, чтобы не дублировать):
| `kind` | Условие | Текст (смысл) |
|---|---|---|
| `auth_expired` | звено завершилось `failed` с `error_reason = 'auth_expired'` | PSN отверг refresh token: нужен новый NPSSO |
| `npsso_invalid` | звено завершилось `failed` с `error_reason = 'npsso_invalid'` | PSN отверг NPSSO: заменить `PSN_NPSSO` |
| `sync_stale` | последний `success` в `sync_runs` старше 3 суток (нет ни одного успеха: считается от самой ранней записи `sync_runs`; записей нет: не срабатывает) | синк не выполнялся N суток, проверить cron и NPSSO |
| `token_age` | (опционально) `psn_auth.updated_at` старше 7 суток | токены PSN не обновлялись N суток, refresh живёт ~10 суток |

Все тексты на русском, с указанием «Инструкция: docs/release.md, раздел 3 (Обновление NPSSO)» (путь в репозитории, без ссылки на хост). Токены и NPSSO в тексте не используются.

**Где вызывается.** `notifyAfterSync(db, {now, run?})` из общего пути запуска синка `src/server/sync/service.ts` (его используют и `GET /api/cron/sync`, и `POST /api/sync`): после звена, закончившегося не `success` и не остановкой по бюджету; и при `config_error` запуска (синк не стартует вообще, это покрывается триггером `sync_stale`). Вызов в `after()`, ошибка уведомлений не влияет ни на синк, ни на ответ роута. Ответы роутов не меняются.

### 15.5 Применение миграций на Neon

Файл `docs/release-neon-0004-0005.sql` для Neon SQL Editor (формат как `docs/release-neon-0001-0003.sql`): идемпотентные `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, запись в журнал drizzle (хеш = sha256 файла миграции, `created_at` = `when` из `_journal.json`), итоговый проверочный `SELECT`. Повторный запуск безопасен. После этого `npm run db:migrate` ничего не применит повторно.

## 16. Бэклог: фильтры и длительность прохождения (Фаза 11)

Решение Артёма: сначала фильтры по жанру и длительности и ручной ввод длительности; HLTB (HowLongToBeat) только как автоматический источник. У HLTB нет официального API, поэтому всё, что с ним связано, необязательно: ручной ввод работает всегда, ошибка HLTB не влияет на синк и данные.

### 16.1 Схема (миграция `0006_hltb_duration`, только добавляет)
Новые колонки `games` (все nullable, без default, существующие данные не меняются):
| Колонка | Тип | Описание |
|---|---|---|
| `hltb_id` | integer | `game_id` HLTB найденной игры. NULL = не найдено или ещё не искали (различает `hltb_checked_at`) |
| `hltb_name` | text | название игры на HLTB (чтобы видеть, с чем сопоставили; защита от ложных совпадений) |
| `hltb_main_hours` | double precision | `comp_main` (Main Story), часы, округлено до 0.1. NULL = у HLTB нет времени. CHECK `> 0` или NULL |
| `hltb_extra_hours` | double precision | `comp_plus` (Main + Extras), часы, 0.1. CHECK `> 0` или NULL |
| `hltb_checked_at` | timestamptz | когда последний раз УСПЕШНО искали (ответ получен, даже если совпадения нет). Ошибка сети/парсинга значение НЕ трогает |
| `duration_override_hours` | double precision | ручная длительность. CHECK `> 0` или NULL. Приоритетнее HLTB. Синк колонку не трогает, HLTB-шаг тоже |

Статус поиска (вычисляется, колонки нет): `hltb_id` не NULL -> `found`; `hltb_checked_at` не NULL и `hltb_id` NULL -> `not_found`; иначе `unchecked`.

Эффективная длительность: `duration_override_hours ?? hltb_main_hours`, иначе неизвестна. `hltb_extra_hours` в расчёт и бакеты не входит (только информационно).

### 16.2 Бакеты
| Ключ | Условие по эффективным часам `h` |
|---|---|
| `lt10` | `h < 10` |
| `10_30` | `10 <= h < 30` |
| `30_60` | `30 <= h < 60` |
| `60plus` | `h >= 60` |
| `unknown` | эффективной длительности нет |

### 16.3 Расширение `GameItem` (9.1)
Добавляется поле (в типе необязательное из-за фикстур `src/ui`, сервер присылает всегда):
```json
"duration": {
  "hours": 24.5,
  "source": "manual",
  "bucket": "10_30",
  "overrideHours": 24.5,
  "hltb": { "status": "found", "id": 2127, "name": "Hades", "mainHours": 21.9, "extraHours": 35.0, "checkedAt": "2026-10-28T17:00:03.000Z" }
}
```
- `hours`: эффективные часы или `null`; `source`: `manual` (есть override) | `hltb` | `null`; `bucket`: ключ 16.2 (при `null` часов = `unknown`).
- `overrideHours`: ручное значение или `null`.
- Фаза 32 (D3), поля `duration`: `remainingHours` (число 0.1+ или `null`) = `max(hours − hours_наиграно, 15% hours)` по 17.4 и `progress` (0..1 или `null`) = `1 − remainingHours / hours`, для тонкой полосы прогресса на карточке бэклога. `hours` остаётся ПОЛНОЙ длительностью (бакеты, фильтры, сортировка `sort=duration` не меняются). Поля присылаются у всех игр; `null`, когда `hours = null`. Карточка бэклога показывает «осталось ≈N ч» из `remainingHours`.
- `hltb.status`: `found | not_found | unchecked`; при не `found` `id`, `name`, `mainHours`, `extraHours` = `null`; `checkedAt` может быть не `null` при `not_found`.

### 16.4 `GET /api/games` (9.2): новые параметры
| Параметр | Значение | По умолчанию |
|---|---|---|
| `genres` | список ключей жанров через запятую (ключи 1.9: `ACTION`, `ROLE_PLAYING_GAMES`, ...). Игра подходит, если среди её эффективных жанров (1.9) есть хотя бы один из выбранных (ИЛИ). Регистр не важен. Неизвестный ключ = `400`. Служебное значение `none` = «без жанра»: у игры нет ни одного жанра (ни `genres_override`, ни `psn_genres`); сочетается с обычными ключами по ИЛИ (`genres=none,HORROR`). По 1.9 такая игра показывается как `OTHER`, поэтому фильтр `OTHER` её тоже захватывает; `none` выделяет только их | без фильтра |
| `duration` | список бакетов 16.2 через запятую (ИЛИ), например `lt10,unknown`. Неизвестный = `400` | без фильтра |
| `hltb` | список статусов HLTB через запятую (ИЛИ): `found` (`hltb_id` есть), `not_found` (`hltb_id` пуст, `hltb_checked_at` задан), `unchecked` (оба пусты). Регистр не важен (`FOUND` = `found`). Это тот же `duration.hltb.status` из 16.3. Ручное значение (`duration_override_hours`) на статус НЕ влияет: игра с override и без совпадения в HLTB остаётся `not_found` и попадает в `hltb=not_found` (так Артём видит, где HLTB не нашёл игру, даже если часы введены руками). `unchecked` (Фаза 18.7) дополнительно исключает игры с ручной длительностью (`duration_override_hours`) и `service`: условие то же, что у `hltbCounts.unchecked`, поэтому число игр в списке равно счётчику. Неизвестное значение = `400` | без фильтра |
| `sort=duration` | по эффективным часам; `order` по умолчанию `asc`; игры без длительности всегда в конце (NULL last), как в 9.2 | |

Фильтры комбинируются с `status`/`q`/`year` через И. `counts` (9.2) теперь учитывает также `genres`, `duration` и `hltb` (табы статуса показывают, сколько игр осталось при выбранных чипах). В типах `sort=duration` это `ListSort`, `GameSort` не менялся. Типичный запрос бэклога: `status=backlog&genres=ACTION&duration=10_30&sort=duration`.

В ответ добавляется `hltbCounts`: `{"found":150,"not_found":20,"unchecked":44}`. Считается по тем же `q`/`status`/`year`/`forgotten`/`hidden`/`genres`/`duration`, но БЕЗ фильтра `hltb`. Все три ключа всегда присутствуют (в т.ч. нулевые); `unchecked` не считает игры с ручной длительностью и `service` (Фаза 18.7), поэтому сумма может быть меньше числа игр в области.

В ответ добавляется `durationCounts`: `{"lt10":3,"10_30":8,"30_60":5,"60plus":2,"unknown":7}`. Считается по тем же `q`/`status`/`year`/`genres`/`hidden`, но БЕЗ фильтра `duration` (для счётчиков на чипах). Сумма = число игр в этой области.

В ответ добавляется `genreCounts`: `{"ACTION":12,"HORROR":4,"OTHER":3,"none":1}`, счётчики жанровых чипов. Считается по тем же `q`/`status`/`year`/`forgotten`/`hidden`/`duration`, но БЕЗ фильтра `genres`. Ключи: ключи жанров 1.9 и `none`; только ненулевые (отсутствующий ключ = 0). Игра с несколькими жанрами считается в каждом, поэтому сумма может превышать число игр; игра без жанров считается и в `OTHER`, и в `none`. Тип `Partial<Record<string, number>>`, в типе `GamesListResponse` поле `genreCounts` обязательное (фикстуры `src/ui` могут его не задавать).

### 16.5 `PATCH /api/games/{id}/duration`
Под сессией, `Content-Type: application/json`, проверка `Origin` (3.4). Тело `{"hours": 24.5}` задаёт ручную длительность, `{"hours": null}` сбрасывает (возврат к HLTB). `hours`: число (не строка, не NaN/Infinity), которое сначала округляется до 0.1 (`Math.round(v*10)/10`), и уже округлённое значение должно лежать в `0.1..1000`; иначе `400 invalid_request`. Следствия: `0.05` -> `0.1` (ок), `24.55` -> `24.6`, `1000.04` -> `1000` (ок); `0.04` -> `0` (400), `1000.05` -> `1000.1` (400), `0`, `-1`, `1001` -> 400. Проверяется диапазон ПОСЛЕ округления, поэтому значения чуть вне границы, которые округляются внутрь, принимаются. Ответ `200` `{"game": GameItem}`; неизвестный id `404 not_found`; БД `503 db_unavailable`. Статус игры не меняется, игра может быть в любом статусе.

### 16.6 Модуль `src/server/hltb/` и шаг синка
- Единственное место с сетью к HLTB. Таймаут запроса 8 с, лимит размера ответа, один запрос за раз с паузой, `User-Agent` обычного браузера. Эндпоинт HLTB меняется (токен инициализации, имя пути), поэтому клиент пробует известные пути (первым `/api/search/site/init` + `/api/search/site`, взят из JS-бандла 2026-10; старые find/bleed/search запасные; форма ответа search/site сверена с реальным ответом Артёма, тест-фикстура в hltb.test.ts), а любой несовпадающий формат ответа = ошибка HLTB (не «не найдено»).
- Диагностика сбоя подключения: `HltbError.message` при провале discovery содержит по каждому пробованному init `init /api/<имя>/init: <HTTP-статус | network | timeout | not_json | too_large | 200 no_token>`, через `; ` (плюс пометки разбора страницы). Тела ответов и токены не включаются; длина детали <= 300 символов. Шаг синка кладёт деталь в `hltb_failed`: `HLTB: ошибок N (<code>: <деталь>), эти игры будут проверены в следующем синке.` После провала discovery клиент в рамках запуска повторно в сеть не ходит.
- Реальный ответ `GET /api/search/site/init` (подтверждён Артёмом): `{"token":"<base64>"}`, без `hpKey`/`hpVal` (их отсутствие допустимо). Токен привязан к IP и User-Agent клиента (внутри base64 timestamp, IP, UA): init и search обязаны идти с одним `User-Agent` (общий объект заголовков клиента) и с одного IP (в рамках одного запуска синка так и есть; токен не кешируется между запусками). Ответ `/api/search/site` подтверждён реальным примером (data[], game_id, game_name, comp_main/comp_plus в секундах); разбор строгий, несовпадение = `bad_response`.
- Запасной поиск пути (не проверен вживую): если известные пути не дали token, клиент читает главную страницу, находит `/_next/static/**/_app-*.js`, берёт имена из `fetch("/api/<имя>...`(до 3, `[A-Za-z0-9_]`) и пробует `/api/<имя>/init`. Имя принимается только если init вернул `token`. Общий бюджет 20 с; при `timeout` на известных путях этот шаг пропускается.
- Запросы на игру (максимум 3, между ними пауза, следующий только если совпадения нет и хватает времени): 1) нормализованное название с ИСХОДНЫМИ римскими цифрами («diablo ii resurrected»), 2) то же с арабскими, 3) укороченное (часть до `:` / ` - `, иначе без последнего слова). Если время вышло посреди поиска игры, «не найдено» не фиксируется. После каждой выдачи: строгое совпадение (Dice с порогом), затем мягкое: имя кандидата точно равно нашему названию без хвостовых слов `classic`/`original` («Gothic Classic» = «Gothic»). Номера частей при этом совпадают обязательно: «Gothic II» не привязывается к «Gothic», «Diablo III» к «Diablo II». Произвольные подзаголовки при сравнении не отбрасываются («Batman: Arkham Knight» не станет «Batman»).
- Название нормализуется (регистр, `™®©`, `:`/`-`, римские цифры, суффиксы изданий: «Game of the Year Edition», «Remastered», «Digital Deluxe», «PS4/PS5» и т.п.). Выбирается лучшее совпадение по схожести (Dice по биграммам) с порогом; ничья и слабое совпадение = `not_found`, а не случайная игра.
- Шаг `hltb` выполняется после фаз `games..trophies` в конце успешного звена (как шаг цвета 15.2, не фаза курсора: число шагов прогресса 8.4 не меняется). Остаток определяется данными, поэтому курсор не нужен.
- Кого обновляем (**правило заменено в 20.1**: теперь любой статус, кроме `service`; прежняя формулировка ниже устарела): видимые игры без `duration_override_hours` и со статусом `backlog`, `playing`, `shelved` или без статуса (не `completed`/`dropped`/`service`), у которых `hltb_checked_at` NULL или старше 30 дней. Порядок: `backlog`, `playing`, `shelved`, без статуса. За звено не больше 20 игр и пока в бюджете времени осталось >= 3 с.
- Защита от сломанного HLTB: если в запуске шага НИ ОДИН запрос не вернул непустую выдачу (при любом размере партии, 1 игра тоже), «не найдено» не записывается, игры остаются непроверенными, в `warnings` пишется `hltb_empty`. «Не найдено» фиксируется только когда в том же запуске был хотя бы один нормальный (непустой) ответ HLTB. Цена: реально неизвестная HLTB единственная новая игра будет перепроверяться каждый синк (один запрос), пока в партии не появится нормальный ответ, и каждый раз давать `hltb_empty`; ручной ввод длительности (16.5) исключает игру из шага.
- Нет совпадения: `hltb_id`, `hltb_name`, `hltb_*_hours` = NULL, `hltb_checked_at = now` (`not_found`, перепроверка через 30 дней). Ошибка HLTB: игра не помечается проверенной, после 3 ошибок подряд шаг прекращается, в `sync_runs.warnings` пишется `hltb_failed` (код ошибки без тела ответа). Итог запуска не меняется (`success` остаётся `success`).
- Если HLTB вернул время, а позже оно пропало (NULL), прежнее значение сохраняется (`coalesce`), как для остальных необязательных полей PSN.

### 16.7 `POST /api/hltb/run`: массовая подгрузка длительности
Запускает ТОЛЬКО шаг HLTB (к PSN не обращается, секреты PSN не нужны), чтобы подтянуть длительность сразу для всех подходящих игр, а не по 20 за суточный синк. Фронт вызывает эндпоинт в цикле, пока `done=false`.
- Доступ: сессия (`src/proxy.ts`), `Content-Type: application/json`, проверка `Origin` (3.4), тело необязательное: `{}` или `{"recheckNotFound": true, "since": "<ISO>"}`. `maxDuration = 60`.
- Перепроверка «не найдено» (после смены матчера 16.6): `recheckNotFound` (boolean, по умолчанию `false`). При `true` обязателен `since` (ISO-время; в будущем сверх допуска 5 секунд на разброс часов = `400 invalid_request`, `details: {"reason":"since_in_future"}`, значение НЕ обрезается до «сейчас»: растущая граница зацикливала бы перепроверку; без `since` или не ISO тоже `400`), и в отбор дополнительно входят игры с `hltb_id IS NULL` и `hltb_checked_at < since` (то есть прежние `not_found`), даже если им нет 30 дней; остальные условия отбора те же (скрытые, ручные и `service` не трогаются; `completed/dropped` берутся с 20.1). Найденные (`hltb_id` есть) не перепроверяются, значения не затираются. Фронт фиксирует `since = now` один раз в начале цикла (при часах клиента впереди сервера более чем на 5 секунд берёт серверное время, например из заголовка `Date` первого ответа, или вычитает запас) и передаёт то же значение во всех вызовах: перепроверенные игры получают `hltb_checked_at >= since` и выходят из отбора, цикл конечен. `remaining` при `true` считается с учётом этой перепроверки.
- Правило отбора то же, что в 16.6 с поправкой 20.1 (видимые, без `duration_override_hours`, любой статус кроме `service`, `hltb_checked_at` NULL или старше 30 дней), порядок тот же. Те же правила: пауза 600 мс между запросами, остановка после 3 ошибок подряд, защита `hltb_empty`.
- Бюджет вызова 45 с (запас 15 с до `maxDuration`: таймаут одного запроса 8 с, первое подключение к HLTB до 20 с, закрытие запуска). Игры берутся пачками по 10 (результат пачки пишется в БД сразу, обрыв функции не теряет сделанное). После каждой пачки пишется heartbeat в `sync_runs.cursor`: запись `kind='hltb'` без heartbeat дольше 2 минут (`HLTB_STALE_RUN_MS`) закрывается как `failed/timeout` при следующем старте синка или HLTB-запуска (для остальных видов порог прежний, 15 минут, `STALE_RUN_MS`), поэтому убитая по `maxDuration` функция не держит слот долго. Новый запрос к HLTB не начинается, если до конца бюджета осталось меньше 9 с. Лимит 20 игр за звено обычного синка не меняется.
- Защита от параллельного запуска: запуск пишется в `sync_runs` с `kind = 'hltb'` и занимает тот же единственный слот `running` (индекс `sync_runs_one_running_idx`). Пока идёт синк или другой HLTB-запуск: `409 sync_in_progress` (`details.runId`). Обратно: пока идёт HLTB-запуск (до ~45 с), `POST /api/sync` и cron получают `already_running`.
- Ответ `200`: `{"ok":true,"data":{"processed":18,"found":15,"notFound":3,"failed":0,"remaining":96,"done":false,"stopReason":"budget","warnings":[{"code":"hltb_failed","message":"..."}]}}`.
  - `processed` = игры, получившие отметку проверки в этом вызове (`found + notFound`); `failed` = игры с ошибкой HLTB (не помечены проверенными, в `processed` не входят); `remaining` = число игр под правилом отбора ПОСЛЕ вызова.
  - `stopReason`: `complete` (подходящих не осталось), `budget` (вышло время), `errors` (3 ошибки HLTB подряд), `empty` (`hltb_empty`: пустая выдача на все запросы, «не найдено» не записано), `no_time` (время вышло до первого запроса).
  - `done = true`, если `remaining = 0` ИЛИ дальнейший прогресс сейчас невозможен (`stopReason` = `errors`/`empty`/`no_time`). `done = false` только при `stopReason = 'budget'` и `processed > 0`, поэтому цикл фронта гарантированно завершается. При `done = true` и `remaining > 0` UI показывает предупреждение из `warnings` и предлагает повторить позже.
  - `warnings` берётся из записи `sync_runs.warnings` этого запуска (`hltb_empty`, `hltb_failed`, тексты как в 16.6).
- Ошибки: `400 invalid_request` (Origin/Content-Type, тело, `since` отсутствует/не ISO/в будущем), `409 sync_in_progress`, `503 db_unavailable` (отдаётся на ЛЮБУЮ внутреннюю ошибку, не только недоступность БД). Ошибка HLTB НЕ ошибка эндпоинта: ответ `200`, `failed > 0`, предупреждение в `warnings`, запись `sync_runs` закрывается как `success`.
- Идемпотентность: повторный вызов обрабатывает только то, что ещё подходит под правило; проверенные игры не трогаются.
- Влияние на индикацию синка: запуски `kind = 'hltb'` ИСКЛЮЧЕНЫ из `GET /api/sync/status`, `GET /api/health`, расчёта `sync_stale` (15.4) и из возобновления `partial`-синка (8.2). Они не сдвигают «последний успешный синк», не показывают баннеры и не маскируют отсутствие настоящего синка. Значение `kind` в этих ответах никогда не бывает `hltb`.
- Схема: миграция `0007_sync_run_kind_hltb`: `ALTER TYPE "sync_run_kind" ADD VALUE 'hltb'` (только добавляет). `docs/release-neon-0007.sql`. Применять ДО деплоя кода: без значения enum вставка запуска упадёт, эндпоинт ответит `503`.

### 16.8 Применение на Neon
`docs/release-neon-0006.sql`: идемпотентный (`ADD COLUMN IF NOT EXISTS`, CHECK через проверку `pg_constraint`), запись в журнал drizzle, проверочный `SELECT`. Применяет Артём вручную до деплоя кода Фазы 11 (код читает новые колонки).


## 17. Роадмап бэклога на год (Фаза 12)

Решения Артёма: один бюджет часов в неделю на год; бэклог идёт в ручном порядке; невышедшие игры вводятся вручную (или подсказкой из RAWG), их часы только ручные; игра с галкой «хочу на релизе» ставится жёстко по дате выхода и в очередь не попадает. Пересчёт плана на лету при каждом `GET /api/roadmap`, ничего не кэшируется (после синка данные уже новые).

Весь раздел под сессией (`src/proxy.ts`). Мутации (`PUT/POST/PATCH/DELETE`) требуют `Content-Type: application/json` (кроме `DELETE` без тела) и проверку `Origin` (3.4). Ответы в конверте 4.1. Календарные даты `YYYY-MM-DD`, «сегодня» и границы недель считаются по Europe/Moscow.

### 17.1 Схема (миграция `0008_roadmap_planning`, только добавляет)
Три новые таблицы. Существующие таблицы и данные не меняются.

**`roadmap_settings`** (ровно одна строка, как `psn_profile`)
| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | smallint PK | нет | всегда 1. CHECK `id = 1` |
| `year` | smallint | нет | год плана. CHECK `2000..2100` |
| `hours_per_week` | double precision | нет | бюджет часов в неделю. CHECK `> 0 and <= 168` |
| `updated_at` | timestamptz | нет, default now() | |

Нет строки = плана ещё не настраивали (`configured: false`).

**Фаза 32 (N2), миграция `0022_roadmap_goal`, expand.** В `roadmap_settings` добавляются две колонки цели года (одна цель в штуках на пользователя):
| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `goal_mode` | text | да | `complete` («пройти N игр за год») или `backlog_to` («довести бэклог до N»). NULL = цели нет. CHECK `goal_mode is null or goal_mode in ('complete','backlog_to')` |
| `goal_count` | smallint | да | N, `0..1000`. CHECK `goal_count is null or (goal_count >= 0 and goal_count <= 1000)`; для `complete` валидация API требует `>= 1`. CHECK `(goal_mode is null) = (goal_count is null)` |

Цель относится к `year` из настроек. Обе колонки пустые у всех существующих строк (цели нет). Данные не меняются.

**`planned_games`** (невышедшие / ещё не купленные игры, вводятся вручную)
| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `title` | text | нет | 1..200 символов после trim |
| `release_date` | date | да | дата выхода (календарная). NULL = дата не известна |
| `cover_url` | text | да | `https://`-ссылка, до 2048 символов |
| `want_at_release` | boolean | нет, default false | галка «хочу пройти на релизе». CHECK `not want_at_release or release_date is not null` |
| `hours_manual` | double precision | да | ручные часы прохождения, `> 0`, до 1000, шаг 0.1. NULL = «нужны часы». HLTB для этих игр не используется |
| `external_source` | text | да | `rawg` или NULL. CHECK `external_source is null or external_source = 'rawg'` |
| `external_id` | text | да | id во внешнем каталоге. CHECK: оба поля `external_*` заданы вместе или оба NULL |
| `status` | text | нет, default `planned` | `planned` (участвует в плане) / `done` (пройдена или куплена, убрана вручную) / `cancelled` (передумал). CHECK на три значения |
| `created_at` / `updated_at` | timestamptz | нет, default now() | |

Индексы: UNIQUE частичный `planned_games_external_key (external_source, external_id) where external_id is not null` (одну игру из каталога дважды не добавить: `409 planned_duplicate`); `planned_games_status_idx (status)`.

**`roadmap_order`** (ручной порядок очереди бэклога)
| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `game_id` | integer PK | нет | FK `games.id` ON DELETE CASCADE |
| `position` | integer | нет | порядок по возрастанию. CHECK `position >= 0` |
| `updated_at` | timestamptz | нет, default now() | |

Индекс `roadmap_order_position_idx (position)`. Игра бэклога без строки встаёт в конец очереди (17.4). Строка игры, ушедшей из `backlog`, остаётся и ничего не делает; при возврате в `backlog` игра займёт прежнее место.

### 17.2 Переменные окружения
`RAWG_API_KEY` (необязательная, только сервер, в `.env.example`). Без неё поиск в каталоге отвечает `503 catalog_unavailable`, всё остальное работает. Ключ не логируется и не попадает в ответы и `details`. Дополняет таблицу раздела 5.

### 17.3 `GET/PUT /api/roadmap/settings`
`GET` -> `200`:
```json
{ "ok": true, "data": { "settings": { "year": 2026, "hoursPerWeek": 10, "configured": true } } }
```
Если строки нет: `{ "year": <текущий год МСК>, "hoursPerWeek": null, "configured": false }`.

`PUT` тело `{ "year": 2026, "hoursPerWeek": 7.5 }`: `year` целое 2000..2100, `hoursPerWeek` число (не строка, не NaN/Infinity) `> 0` и `<= 168`, округляется до 0.1 (после округления снова `>= 0.1`). Upsert одной строки. Ответ как у `GET` (`configured: true`). Ошибки: `400 invalid_request`, `503 db_unavailable`.

### 17.3a `GET/PUT/DELETE /api/roadmap/goal` (Фаза 32, N2)
Цель года в штуках, по пользователю. Сессия, мутации с `Content-Type: application/json` и `Origin`.
`GET` -> `200 { "goal": GoalView | null }`. `null` = цели нет (или настройки плана ещё не созданы).
`PUT` тело `{ "mode": "complete" | "backlog_to", "count": 12 }`: `count` целое, `complete` `1..1000`, `backlog_to` `0..1000`; лишние поля = `400`. Upsert в `roadmap_settings` (`goal_mode`, `goal_count`), год и бюджет не трогает. Ответ `200 { "goal": GoalView }`. Ошибки: `400 invalid_request`, `409 settings_required` (строки `roadmap_settings` ещё нет: сначала `PUT /settings`), `503 db_unavailable`.
`DELETE` -> `200 { "goal": null }`, идемпотентно (нет строки = тоже `null`).
`PUT /settings` (17.3) цель НЕ сбрасывает; `GET /settings` формат не меняет.

**`GoalView`** (считается на лету, также приходит в `GET /api/roadmap` как `goal`, 17.5):
```json
{ "mode": "complete", "count": 12, "year": 2026,
  "current": 7, "target": 12, "remaining": 5,
  "pacePerMonth": 0.8, "paceEmpty": false,
  "forecast": 8.9, "forecastAtYearEnd": 9,
  "requiredPerMonth": 2.4,
  "status": "behind", "diff": -3.1, "asOf": "2026-11-01" }
```
| Поле | Смысл |
|---|---|
| `current` | `complete`: игры со статусом `completed`, видимые, у которых `completed_at` (МСК) в `year`. `backlog_to`: сейчас видимых игр со статусом `backlog` (включая исключённые из плана) |
| `target` | `count` |
| `remaining` | сколько ещё сделать: `complete` `max(0, N − current)`; `backlog_to` `max(0, current − N)` |
| `pacePerMonth` | темп завершений в месяц: `завершено_в_году / прошло_дней * 30.44`, где `прошло_дней` = от 1 января (или от `year`-начала) до `today` включительно, не больше длины года; округлено до 0.1. Темп считается по `completed_at` (для обоих режимов: бэклог уменьшается завершениями) |
| `paceEmpty` | `true`, если в году нет ни одного завершения (темп 0, прогноз = текущее значение, без экстраполяции) |
| `forecast` | значение на 31 декабря при текущем темпе: `complete` `current + темп_в_день * осталось_дней`; `backlog_to` `max(0, current − темп_в_день * осталось_дней)`; округлено до 0.1. Допущение: новые игры в бэклог за остаток года не добавляются |
| `forecastAtYearEnd` | `forecast`, округлённое до целого (для `complete` вниз, для `backlog_to` вверх: консервативно) |
| `requiredPerMonth` | нужный темп, чтобы успеть: `remaining / осталось_дней * 30.44`, 0.1; `0`, если цель достигнута или год кончился |
| `status` | `achieved` (цель уже выполнена: `complete` `current >= N`, `backlog_to` `current <= N`) \| `ahead` \| `onTrack` \| `behind` \| `not_started` (`today` раньше 1 января года) |
| `diff` | `complete`: `forecast − N`; `backlog_to`: `N − forecast`. Плюс = опережаю. `ahead` при `diff >= 1`, `behind` при `diff <= -1`, иначе `onTrack` (допуск 1 игра). У `achieved`/`not_started` `diff` = 0 для `not_started`, расчётное для `achieved` |
| `asOf` | сегодня МСК |
Для прошедшего года (`today` после 31 декабря) `осталось_дней = 0`, `forecast = current`, `status` `achieved` или `behind`. Для будущего года `not_started`.

### 17.4 Модель плана (алгоритм `src/server/roadmap/`, чистые функции)
Время ведётся по дням года (1 января..31 декабря выбранного года). Бюджет `b` = `hoursPerWeek`, в день `b / 7`.

**Недели.** Это НЕ ISO-недели. Неделя = понедельник..воскресенье по МСК; первая и последняя недели обрезаются границами года (1 янв и 31 дек), `days` < 7, ёмкость обрезанной недели `b * days / 7`. Причина: план одного года не смешивается с соседним (ISO-неделя 1 может начинаться в декабре прошлого года), суммарная ёмкость года ровно `b * днейВГоду / 7`. Нумерация `index` с 1 подряд внутри года. Год из 365 дней даёт 53 строки `weeks`, из 366 тоже (понедельники делят год по-разному, первая и последняя обрезаны).

**Игры плана** (`kind`):
- `release`: `planned_games` со `status = 'planned'`, `want_at_release = true` (дата обязательна по CHECK). Ставятся жёстко ПЕРВЫМИ.
- `backlog`: `games` со статусом `backlog`, видимые (`hidden_at` is null). Очередь в порядке `roadmap_order.position` asc, затем игры без позиции в порядке попадания в бэклог (`game_status.status_changed_at` asc, затем `games.id`).
- `planned`: `planned_games` со `status = 'planned'` БЕЗ галки. Идут в очередь ПОСЛЕ всех игр бэклога, по `release_date` (NULL в конце), затем `id`, и не раньше своей даты выхода (если она есть). Допущение: в решениях Артёма про такие игры нет явного правила.

**Часы игры.** `backlog`: ОСТАТОК (Фаза 32, D3, см. «Остаток часов» ниже), посчитанный от базы `duration_override_hours` > `hltb_main_hours` (`hoursSource`: `manual` | `hltb`). `release` и `planned`: `hours_manual` (`manual`, наиграно нет, остаток не считается). Нет базы или `<= 0` = игра в `needHours`, в плане не участвует.

**Остаток часов (Фаза 32, D3; чистая функция `remainingHours`, `src/shared/remaining.ts`).** `осталось = max(база − наиграно, 15% базы)`, где `база` = `duration_override_hours`, иначе `hltb_main_hours` (ручная оценка приоритетнее HLTB, и она трактуется как ПОЛНАЯ длительность, не как остаток; решение реализации, подтвердить у Артёма), `наиграно` = часы игры (`playSeconds`, с версиями-дублями, 25.3). Пол 15% нужен, чтобы игра, у которой наиграно больше HLTB, не получала 0 часов. Результат округляется до 0.1, минимум 0.1. Нет базы (`null`, `<= 0`, не число) = остаток `null`. `progress` = `1 − осталось / база`, 0..1, округлено до 0.01 (потолок 0.85 из-за пола). Остаток считается на момент запроса, сам нигде не хранится. Поля `hours` игры бэклога в `items`/`queue`/`notFit`/`needHours`/`unallocated` (17.5) теперь остаток; полная длительность отдаётся в `totalHours`, наиграно в `playedHours` (необязательные поля записи, только у `kind = backlog`, у остальных `null`). Исключение: прогресс 17.6 по-прежнему считает плановые часы от ПОЛНОЙ базы (его очередь «как была» не меняется), чтобы начатая игра не искажала «Отстаю/опережаю» по часам.

**Шаг 1. Релизы (жёстко).** Сортировка по `(release_date, id)`. Окно игры = `7 * ceil(hours / b)` дней подряд с РЕАЛЬНОЙ даты релиза. Если дата до 1 января плана, окно обрезается по 1 января без тихого сдвига: прошлая часть попадает в `conflicts` с причиной `starts_before_year`, часы в план берутся пропорционально дням внутри года. Часы распределяются по окну равномерно. Если окно предыдущего релиза ещё занято, игра сдвигается на первый свободный день: её окно начинается позже, а промежуток `[дата релиза .. день перед фактическим стартом]` попадает в `conflicts` с причиной `release_overlap`. Окно, выходящее за 31 декабря: `conflicts` причина `exceeds_year_end` (промежуток `[старт .. 31 дек]`); если в оставшихся днях года часы всё равно помещаются (`дней * b / 7 >= hours`), игра ставится в обрезанное окно, иначе уходит в `notFit` и дни остаются свободными. Релиз после 31 декабря: `notFit` причина `after_year_end` (конфликта нет). Весь срок окна принадлежит релизу (остаток последней недели другим играм не отдаётся); в день уходит `hours / дней окна`, то есть не больше `b / 7`.

**Шаг 2. Очередь заполняет свободные дни.** Игре нужно `ceil(7 * hours / b)` свободных дней (минимум 1). Игра занимает ОДИН непрерывный интервал: окно релиза игру НЕ разрывает. Для каждой игры по порядку очереди ищется первое свободное окно достаточной длины, начиная с дня после предыдущей поставленной игры очереди (для `planned` не раньше даты выхода); короткие окна между релизами пропускаются. Нигде не влезло: `notFit` причина `no_capacity` (`hoursShort` = нехватка до самого длинного подходящего окна), очередь НЕ останавливается (следующая, более короткая игра ставится). `segments` всегда ровно один элемент.

**`planned` без галки** (`want_at_release = false`): идёт в очередь после всего бэклога, по `release_date` (NULL в конце), не раньше даты выхода; влезает по правилам выше ставится, иначе `notFit`. Релиз с галкой, дата которого уже прошла, но дни заняты: ставится на первый свободный день после занятых, конфликт `release_overlap` с промежутком от даты релиза.

**Бюджет.** Одна настройка `hoursPerWeek` (+ `year`); план нигде не кэшируется, смена настроек пересчитывает его при следующем `GET /api/roadmap`.

**Начало плана.** План всегда строится с 1 января выбранного года, даже если сегодня октябрь: прошлое не «забывается», на нём считается прогресс (17.6). Из-за этого прошедшие недели показывают игры, которые лежат в бэклоге сейчас (см. риски в отчёте реализации).

**Некорректный бюджет** (нет настроек, `hoursPerWeek` `null`, `<= 0`, `NaN`, `> 168`): `status: "no_budget"`, `items`, `conflicts`, `notFit`, `progress` пусты/`null`, `needHours` считается (от бюджета не зависит), `weeks`/`months` с нулевой ёмкостью.

**Пустой год** (нет игр): `status: "ok"`, `items` пуст, `weeks`/`months` с ёмкостью и нулевой загрузкой.

### 17.5 `GET /api/roadmap`
Считается на лету: настройки + игры + `planned_games` + снимки часов. Без параметров (год берётся из настроек). `200`:
```json
{
  "ok": true,
  "data": {
    "settings": { "year": 2026, "hoursPerWeek": 10, "configured": true },
    "status": "ok",
    "today": "2026-10-29",
    "range": { "from": "2026-01-01", "to": "2026-12-31", "days": 365 },
    "totals": { "capacityHours": 521.4, "plannedHours": 388.0 },
    "weeks": [
      { "index": 1, "from": "2026-01-01", "to": "2026-01-04", "days": 4, "capacityHours": 5.7, "plannedHours": 5.7,
        "items": [ { "key": "g:12", "hours": 5.7 } ] }
    ],
    "months": [
      { "month": "2026-01", "from": "2026-01-01", "to": "2026-01-31", "days": 31, "capacityHours": 44.3, "plannedHours": 44.3,
        "items": [ { "key": "g:12", "hours": 30.2 }, { "key": "p:3", "hours": 14.1 } ] }
    ],
    "items": [
      {
        "key": "p:3", "kind": "release", "gameId": null, "plannedId": 3,
        "title": "Resident Evil Requiem", "coverUrl": "https://media.rawg.io/media/games/xxx.jpg",
        "hours": 14, "hoursSource": "manual", "releaseDate": "2026-02-27", "wantAtRelease": true,
        "start": "2026-02-27", "end": "2026-03-12", "days": 14, "shiftedDays": 0, "queuePosition": null,
        "segments": [ { "from": "2026-02-27", "to": "2026-03-12", "days": 14, "hours": 14 } ]
      },
      {
        "key": "g:12", "kind": "backlog", "gameId": 12, "plannedId": null,
        "title": "Hades", "coverUrl": "https://image.api.playstation.com/...",
        "hours": 22, "hoursSource": "hltb", "releaseDate": null, "wantAtRelease": false,
        "start": "2026-01-01", "end": "2026-02-26", "days": 57, "shiftedDays": 0, "queuePosition": 1,
        "segments": [ { "from": "2026-01-01", "to": "2026-02-26", "days": 57, "hours": 22 } ]
      }
    ],
    "queue": [ { "key": "g:12", "state": "scheduled" }, { "key": "g:40", "state": "need_hours" }, { "key": "g:41", "state": "not_fit" } ],
    "conflicts": [
      { "reason": "release_overlap", "from": "2026-03-05", "to": "2026-03-12", "keys": ["p:3", "p:4"] }
    ],
    "notFit": [
      { "key": "g:41", "kind": "backlog", "gameId": 41, "plannedId": null, "title": "...", "coverUrl": null,
        "hours": 120, "hoursSource": "hltb", "releaseDate": null, "wantAtRelease": false,
        "reason": "no_capacity", "hoursShort": 35.4 }
    ],
    "needHours": [
      { "key": "g:40", "kind": "backlog", "gameId": 40, "plannedId": null, "title": "...", "coverUrl": null,
        "hours": null, "hoursSource": null, "releaseDate": null, "wantAtRelease": false }
    ],
    "progress": {
      "status": "behind", "from": "2026-01-15", "asOf": "2026-10-28",
      "plannedHours": 280.5, "actualHours": 262, "diffHours": -18.5, "toleranceHours": 2, "budgetHours": 390.0
    }
  }
}
```
- Общая запись игры (`Entry`): `key` (`g:<games.id>` для бэклога, `p:<planned_games.id>` для остальных; стабилен, по нему фронт склеивает списки), `kind` (`release` | `backlog` | `planned`), `gameId`/`plannedId` (одно из двух не `null`), `title`, `coverUrl` (`games.image_url` или `planned_games.cover_url`, может быть `null`), `hours` (число или `null`), `hoursSource` (`manual` | `hltb` | `null`), `releaseDate` (`null` для бэклога), `wantAtRelease`.
- `items`: игры, поставленные в план, сортировка по `start`, затем `key`. Добавляют `start`/`end` (включительно), `days` (число занятых дней), `segments` (всегда ровно один отрезок `{from,to,days,hours}` = весь интервал игры), `shiftedDays` (для `release`: на сколько дней старт позже даты релиза, иначе 0), `queuePosition` (место в `queue`, 1-based; `null` для `release`).
- `queue`: ВСЯ очередь (игры бэклога в ручном порядке, затем `planned` без галки) со статусом `scheduled` | `not_fit` | `need_hours` (`unplanned` вместо `scheduled` только при `status = "no_budget"`: план не строился). Источник списка для drag&drop; перетаскиваются только записи с `key` вида `g:*` (в `PUT /api/roadmap/order` уходят их `gameId`). `release` в очередь не входят.
- `conflicts`: промежутки, где план идёт вразрез. `reason`: `release_overlap` (желаемая дата релиза занята предыдущим релизом) | `exceeds_year_end` | `starts_before_year` (релиз с галкой вышел до 1 января плана: окно считается от реальной даты, `from..to` = часть окна в прошлом году; в `items` остаётся только часть внутри года, `segments[0].hours` = часы пропорционально дням внутри года, а `hours` игры полные; если всё окно в прошлом году, игра в `items` не попадает, видна только конфликтом). `from`/`to` включительно. `keys`: затронутые игры (для `release_overlap` сначала блокирующие, последним сдвинутая). Отсортированы по `from`.
- `notFit`: «не успеваю». `reason`: `no_capacity` (очередь не влезла в год) | `exceeds_year_end` (релиз, у которого после даты выхода не остаётся дней) | `after_year_end` (выходит после 31 декабря). `hoursShort`: на сколько часов не хватает (0.1) или `null` для `after_year_end`.
- `needHours`: нужны часы, в план не поставлены. Порядок: `backlog` (очередь), затем остальные.
- `weeks[].items` / `months[].items`: часы каждой игры внутри периода (округлено до 0.1, нулевые опущены). `plannedHours` = сумма до округления, затем округляется до 0.1, поэтому сумма `items` может отличаться на 0.1.
- `months`: 12 штук. Ёмкость месяца `b * days / 7`.
- `today`: сегодняшняя дата МСК.
- `progress`: `null` при `status = "no_budget"`, иначе см. 17.6.
- `goal` (Фаза 32): `GoalView` (17.3a) или `null`, если цели нет. НЕ зависит от `status` плана (цель считается и при `no_budget`). Это главный сигнал «Отстаю/опережаю» при заданной цели: фронт показывает `goal.status`/`goal.diff`; `progress` (по часам) остаётся как есть и показывается, когда цели нет.
- `totalHours`, `playedHours` (Фаза 32, D3): необязательные поля записи `Entry` игр бэклога: полная база (override/HLTB) и наиграно, часы с шагом 0.1. `hours` = остаток (17.4).
- Ошибки: `503 db_unavailable` (любая внутренняя ошибка, как в 16.7). Ошибка PSN невозможна (эндпоинт PSN не трогает).

### 17.6 Прогресс (`progress`)
Сравнивает факт часов из `playtime_snapshots` с тем, сколько по плану должно быть сыграно к сегодняшнему дню.
- Игры плана: игры, у которых есть строка в `roadmap_order`, плюс текущая очередь бэклога (`kind = backlog`). Из этого множества исключаются игры со статусом `service` и игры, исключённые из плана (`roadmap_excluded`, 17.12); `completed` остаются (17.11). Строки `roadmap_order` при смене статуса игры не удаляются (в т.ч. `PUT /order` трогает только строки текущего бэклога и переданных id), поэтому начатая или пройденная игра остаётся в плане для прогресса. Исключение (Фаза 18.7, N-2): при смене статуса НА `backlog` (одиночной и массовой) строка `roadmap_order` этой игры удаляется, и вернувшаяся игра встаёт в конец очереди.
- Факт: часы по снимкам (расчёт 1.6: `secondsByGame`) ТОЛЬКО по играм плана. Плановые часы тоже только по ним (`items` с `gameId` из этого множества).
- Ограничения (связи нет, не выдумываем): релизные игры (`planned_games`) после покупки не связаны с записью в `games`, поэтому их часы в факт и план прогресса не входят; игра, ушедшая из бэклога до первого `PUT /order` и не имеющая строки в `roadmap_order`, в план прогресса не попадает; ~~игра, ушедшая из бэклога, выпадает из `items`~~ (исправлено в Фазе 18.7, N-3): `progress` считается по отдельному плану очереди «как была» (текущий бэклог + игры со строкой `roadmap_order` вне бэклога, кроме `service` и исключённых; порядок по `position`), поэтому плановые часы ушедшей игры не пропадают и «опережаю» не завышается. Публичные `items`/`queue` строятся по-прежнему только из текущего бэклога. Приближение: часы ушедшей игры берутся по текущей длительности (override/HLTB), а позиции старых строк могут совпадать с новыми после `PUT /order` (тай-брейк по дате статуса и id).
- Период: от `from` до `asOf`. `asOf` = ВЧЕРА по МСК (сегодняшний день в план не входит: снимок за сегодня появляется вечером), не позже 31 декабря; для прошедшего года весь год. `from` = 1 января, если первый снимок в БД раньше года; иначе день после первого снимка (до первого синка истории часов нет: 10.1).
- `status`: `ahead` (`diffHours > toleranceHours`), `behind` (`diffHours < -toleranceHours`), `onTrack` (иначе); `no_data` (нет снимков или `from > asOf`; числа 0); `not_started` (год ещё не начался или `asOf` раньше 1 января; числа 0). `toleranceHours = 2`.
- `diffHours = actualHours - plannedHours` (минус = отстаю), все часы с шагом 0.1.
- `budgetHours` = `hoursPerWeek * дней(from..asOf) / 7`, справочное «сколько часов выделено на это время»; на `status` не влияет.

### 17.7 `GET/POST /api/roadmap/planned`, `PATCH/DELETE /api/roadmap/planned/{id}`
Объект `PlannedGame`:
```json
{ "id": 3, "title": "Resident Evil Requiem", "releaseDate": "2026-02-27", "coverUrl": "https://media.rawg.io/...", "wantAtRelease": true,
  "hoursManual": 14, "externalSource": "rawg", "externalId": "123456", "status": "planned",
  "createdAt": "2026-10-29T10:00:00.000Z", "updatedAt": "2026-10-29T10:00:00.000Z" }
```
- `GET /api/roadmap/planned?status=planned|done|cancelled|all` (по умолчанию `all`) -> `{ "planned": [PlannedGame] }`, порядок: `release_date` asc (NULL в конце), затем `id`. Неизвестный `status` = `400`.
- `POST` тело: `title` (обязателен), `releaseDate` (`YYYY-MM-DD` или `null`), `coverUrl` (https или `null`), `wantAtRelease` (boolean, по умолчанию `false`), `hoursManual` (число `0.1..1000` или `null`, округляется до 0.1), `externalSource` (`"rawg"`) и `externalId` (непустая строка до 64 символов) вместе или оба отсутствуют. `status` создаётся `planned`. Ответ `200` `{ "planned": PlannedGame }` (в проекте мутации тоже отвечают `200`).
- `PATCH` тело: любое непустое подмножество `title`, `releaseDate`, `coverUrl`, `wantAtRelease`, `hoursManual`, `status`. `status` принимает `planned` | `done` | `cancelled` | `unallocated` (`unallocated` = алиас `cancelled`, хранится и отдаётся в `PlannedGame.status` как `cancelled`). `cancelled`/`unallocated` убирает релиз из плана в блок «Не распределено» (17.12), `planned` возвращает. Тот же алиас принимает фильтр `GET /planned?status=`. `externalSource`/`externalId` не меняются (приходят = `400`). Итоговое состояние проверяется целиком: `wantAtRelease = true` без `releaseDate` = `400` с `details: {"reason":"want_requires_release_date"}`. Ответ `{ "planned": PlannedGame }`.
- `DELETE` -> `{ "deleted": true, "id": 3 }`. Физическое удаление (данные вводились вручную; обратимо «убрать из плана» делает `status`).
- Ошибки: `400 invalid_request` (id не положительное целое, Origin/Content-Type, тело, даты `2026-02-30` и прочие несуществующие), `404 not_found`, `409 planned_duplicate` (тот же `externalSource+externalId` уже есть, `details.id` существующей), `503 db_unavailable`.

### 17.8 `PUT /api/roadmap/order`
Тело `{ "gameIds": [12, 40, 41] }`: полный порядок очереди бэклога от первой к последней. Целые положительные, без повторов, до 1000, id должны существовать в `games` (иначе `400 invalid_request`, `details.unknown` = список). Сервер одной транзакцией удаляет строки `roadmap_order` текущих игр бэклога и переданных id и вставляет новые (`position` = индекс в массиве); строки игр, ушедших из бэклога, сохраняются. Игры бэклога, которых нет в массиве (появились после загрузки экрана), встанут в конец. Пустой массив допустим (сброс порядка). Ответ `{ "order": [12, 40, 41] }`. Ошибки: `400`, `503`. Дополнения 17.11 и 17.12: id игр со статусом `service` и исключённых из плана отклоняются (`400`, `details.reason`). Клиент больше не показывает `not_fit` в очереди, но ОБЯЗАН присылать ПОЛНЫЙ порядок всех `g:*` из `queue` (включая `not_fit` и `need_hours`); сервер сохраняет относительный порядок как есть, пропущенные игры бэклога встанут в конец.

### 17.9 `GET /api/roadmap/catalog/search?q=...` (RAWG)
Подсказка для формы «Добавить релиз»: ищет игру по названию во внешнем каталоге RAWG. Это подсказка, не истина: дату и обложку можно править вручную, а ручной ввод работает всегда.
- `q`: 2..100 символов после trim, иначе `400 invalid_request`.
- `playstation` (необязательный): `1`/`true` добавляет к запросу RAWG `platforms=187,18` (PlayStation 5 и 4; id из `GET /api/platforms` RAWG), то есть фильтр работает на стороне каталога, а не по 10 найденным. Нет параметра, `0`, `false` или пусто = без фильтра (как раньше). Другое значение = `400`. Поле `playstation` у кандидата не меняется.
- Запрос сервера: `GET https://api.rawg.io/api/games?key=<RAWG_API_KEY>&search=<q>&page_size=10` (по документации rawg.io/apidocs; ключ только на сервере, таймаут 8 с, размер ответа до 1 МБ). Формат ответа RAWG: `{ "count", "results": [ { "id", "name", "released": "YYYY-MM-DD" | null, "tba": boolean, "background_image": "https://..." | null, "platforms": [ { "platform": { "id", "name", "slug" } } ] | null } ] }`. Поля вне этого списка игнорируются; результат с неожиданной формой = `catalog_unavailable` (`bad_response`), а не пустой список.
- `200`:
```json
{ "ok": true, "data": { "candidates": [
  { "externalSource": "rawg", "externalId": "123456", "title": "Resident Evil Requiem", "releaseDate": "2026-02-27",
    "coverUrl": "https://media.rawg.io/media/games/xxx.jpg", "platforms": ["PlayStation 5", "PC"], "playstation": true }
] } }
```
  `externalId` строкой (`id` RAWG числом). `releaseDate` = `released`, если корректная дата и не `tba`, иначе `null`. `platforms` = названия платформ или `[]`. `playstation` = среди платформ есть `slug`, начинающийся с `playstation`; кандидаты с `playstation = true` идут первыми, внутри групп порядок RAWG (релевантность). Пустая выдача = `candidates: []`.
- Ошибки: `400 invalid_request`; `503 catalog_unavailable` (нет `RAWG_API_KEY`, сеть, таймаут, HTTP не 2xx, лимит, неожиданная форма), `details: {"reason":"no_key"|"timeout"|"network"|"http_error"|"rate_limited"|"bad_response"}`. Тексты и `details` не содержат ключа и URL. Экран при `503` не ломается, форма остаётся доступна для ручного ввода.
- Атрибуция: условия RAWG требуют активную ссылку на RAWG там, где показываются их данные (frontend ставит «Данные: RAWG» на экране роадмапа).
- PS Store через `psn-api` не используется (в библиотеке нет каталога магазина, `docs/api-notes.md`). Обложка и дата только из RAWG или вручную.

### 17.10 Применение на Neon
`docs/release-neon-0008.sql`: идемпотентный (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, FK и CHECK через проверку `pg_constraint`), запись в журнал drizzle, проверочный `SELECT`. Только создаёт новые таблицы, существующие данные не затрагивает (потери данных нет). Применяет Артём вручную в Neon SQL Editor до деплоя кода Фазы 12 (код читает новые таблицы; без них эндпоинты раздела 17 отвечают `503 db_unavailable`). Остальная часть сайта от миграции не зависит.

### 17.11 Игры-сервисы (правка после выкатки)
Статусы `backlog` и `service` взаимоисключающие (одна строка `game_status`), поэтому игра-сервис в очередь и так не попадает. Правка это закрепляет и даёт отдельный список:
- Прогресс (17.6): `service` убирается из множества игр плана (даже если у игры осталась строка `roadmap_order`). `completed` и прочие статусы не трогаются.
- `PUT /api/roadmap/order`: id игры со статусом `service` = `400 invalid_request`, `details: {"reason":"service_game","ids":[...]}`. Проверка после проверки на неизвестные id.
- `GET /api/roadmap` отдаёт `serviceGames` для таблицы «Игры-сервисы: в план не берём»: видимые игры (`hidden_at` is null) со статусом `service`, порядок `last_played_at` desc (NULL в конце), затем `id`, не более 50:
```json
"serviceGames": [ { "gameId": 7, "title": "Fortnite", "coverUrl": "https://...", "playedHours": 312.4 } ]
```
`playedHours` = `play_duration_seconds / 3600`, шаг 0.1. Поле есть всегда (при `no_budget` тоже), пустой список = `[]`.

### 17.12 «Не распределено» (убрать из плана)
Решение Артёма: «убрать из плана» любую игру плана переводит её в блок «Не распределено»; оттуда её можно вернуть.
- **Игры бэклога (`g:*`).** Новая таблица (миграция `0009_roadmap_excluded`, только добавляет):

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `game_id` | integer PK | нет | FK `games.id` ON DELETE CASCADE |
| `created_at` | timestamptz | нет, default now() | |

  Исключённая игра остаётся со статусом `backlog` в приложении, но не участвует в очереди, плане, `notFit`, `needHours`, `conflicts`, прогрессе (ни план, ни факт). При исключении строка `roadmap_order` игры удаляется. Возврат = удаление строки; игра встаёт в КОНЕЦ очереди (сервер фиксирует текущий эффективный порядок очереди в `roadmap_order` и добавляет возвращаемую игру последней). Строка для игры, ушедшей из `backlog`, остаётся и игнорируется (в `unallocated` попадает только игра со статусом `backlog`, `hidden_at` is null).
- **Релизы (`p:*`).** Существующий `planned_games.status = 'cancelled'` = «не распределено» (в контракте и DTO `unallocated`). Миграции нет. Убрать: `PATCH /planned/{id}` `{"status":"unallocated"}` (или `"cancelled"`). Вернуть: `{"status":"planned"}`. Окончательное удаление: существующий `DELETE /planned/{id}`.
- `POST /api/roadmap/exclusions` тело `{ "gameId": 12 }` -> `200 { "excluded": true, "gameId": 12 }`. Идемпотентно (повтор тоже `200`, порядок не меняется). Ошибки: `400 invalid_request` (тело; игра не в статусе `backlog`: `details.reason = "not_backlog"`), `404 not_found` (нет игры), `503`.
- `DELETE /api/roadmap/exclusions/{gameId}` -> `200 { "excluded": false, "gameId": 12 }`. Идемпотентно (нет строки = тоже `200`). Ошибки: `400` (id), `404 not_found` (нет такой игры), `503`.
- `GET /api/roadmap` отдаёт `unallocated`, всегда (при `no_budget` тоже):
```json
"unallocated": [
  { "key": "g:12", "kind": "backlog", "gameId": 12, "plannedId": null, "title": "Hades", "coverUrl": "https://...",
    "hours": 22, "hoursSource": "hltb", "releaseDate": null, "wantAtRelease": false },
  { "key": "p:5", "kind": "planned", "gameId": null, "plannedId": 5, "title": "Новинка", "coverUrl": null,
    "hours": null, "hoursSource": null, "releaseDate": "2027-03-01", "wantAtRelease": false }
]
```
  Поля как у `Entry` (17.5). Для релиза `kind` = `release` при `wantAtRelease` с датой, иначе `planned`. Порядок: сначала игры бэклога (по `created_at` исключения desc, затем `id`), затем релизы (по `updated_at` desc, затем `id`). Для вернуть: `key` с `g:` -> `DELETE /exclusions/{gameId}`, с `p:` -> `PATCH /planned/{plannedId}` `{"status":"planned"}`.
- `PUT /api/roadmap/order`: id исключённой игры = `400 invalid_request`, `details: {"reason":"excluded","ids":[...]}`.
- `queue`, `items`, `notFit`, `needHours` исключённые игры и отменённые релизы не содержат (как и раньше для `cancelled`).

### 17.13 `GET /api/roadmap/catalog/upcoming?page=N` (RAWG, без поиска)
Список предстоящих релизов на год вперёд для экрана «Добавить релиз».
- `page`: целое `>= 1`, по умолчанию 1; иначе `400 invalid_request`.
- Запрос сервера: `GET https://api.rawg.io/api/games?key=...&dates=<сегодня МСК>,<сегодня +365 дней>&ordering=released&platforms=187,18&page_size=20&page=N` (платформы PlayStation всегда). Записи без даты (`tba`, `released = null`) пропускаются, поэтому на странице может быть меньше 20. Порядок RAWG (по дате выхода).
- Кэш: ответ RAWG по паре (диапазон дат, страница) хранится в памяти процесса 1 час (бережём лимит 20k/мес). Ошибки не кэшируются. Пометки «в плане» считаются при каждом запросе по БД, кэшу не подвержены. На Vercel кэш живёт в пределах тёплого экземпляра функции.
- `200`:
```json
{ "ok": true, "data": { "candidates": [
  { "externalSource": "rawg", "externalId": "123456", "title": "Resident Evil Requiem", "releaseDate": "2026-11-27",
    "coverUrl": "https://media.rawg.io/...", "platforms": ["PlayStation 5"], "playstation": true,
    "planned": false, "unallocated": false, "plannedId": null }
], "page": 1, "hasMore": true } }
```
  Кандидат как в 17.9 плюс: `planned` (есть запись `planned_games` с этим `externalSource+externalId` в ЛЮБОМ статусе), `unallocated` (запись есть и её статус `cancelled`), `plannedId` (id записи или `null`). Для `status = done` будет `planned: true, unallocated: false`. `hasMore` = у RAWG есть следующая страница.
- Ошибки: `400 invalid_request`; `503 catalog_unavailable` с `details.reason` как в 17.9; `503 db_unavailable` (не удалось проверить пометки).

### 17.14 Применение 0009 на Neon
`docs/release-neon-0009.sql`: идемпотентный (`CREATE TABLE IF NOT EXISTS`, FK через проверку `pg_constraint`), запись в журнал drizzle, проверочный `SELECT`. Только создаёт таблицу `roadmap_excluded`, потери данных нет. Применять ДО деплоя этой правки: без таблицы `GET /api/roadmap` отвечает `503 db_unavailable`.

### 17.15 Лучшая позиция вставки для `notFit`
Для записей `notFit` с `kind = "backlog"` и `reason = "no_capacity"` добавлены поля (у `p:*`, `after_year_end`, `exceeds_year_end` их НЕТ):
```json
{ "key": "g:41", "reason": "no_capacity", "hoursShort": 78.6, "insertAt": 2, "displacesAtInsert": 1, "displacedTitles": ["Hades"] }
```
- `insertAt`: 1-based позиция среди `g:*` в порядке очереди (с учётом только текущих `g:*`), на которую нужно поставить игру, чтобы она влезла. Выбирается САМАЯ ПОЗДНЯЯ из подходящих позиций (минимальный сдвиг вверх). `null`: даже на позиции 1 не влезет (игра длиннее года, окна релизов не оставляют непрерывного интервала) или проба не считалась (см. бюджет).
- `displacesAtInsert`: сколько ДРУГИХ игр бэклога из текущих `items` перестанут влезать при такой вставке. `0` при `insertAt = null` из-за «нигде не влезет». `null`, если проба не считалась.
- `displacedTitles`: названия до 5 таких игр (в порядке плана), остальные отбрасываются. `[]` / `null` по тем же правилам.
- `hoursShort` прежний.
- Почему не «в конец»: игра проверяется при указателе очереди, который ходит только вперёд; её размещение зависит лишь от игр ДО неё и от релизов, поэтому перенос вниз не помогает, помогает только вставка выше. Влезание монотонно по позиции (чем выше, тем не хуже), поэтому поиск бинарный.
- Считается пробными `buildPlan` на копии входа. Общий бюджет 200 проб на ответ (на игру ~2 + log2(позиции)); кому не хватило, у тех все три поля `null`. Замер: 300 игр, 292 не влезло, весь `buildPlan` около 56 мс.
- Применить: `PUT /api/roadmap/order` с полным порядком `g:*`, где игра стоит на `insertAt`. Вытесненные игры уйдут в `notFit`.
- `GET /api/roadmap` ничего не кэширует: после `POST /exclusions` и `PATCH planned` следующий `GET` возвращает пересчитанные `notFit`.

## 18. Рекомендации «Подскажи» (Фаза 13)

Решение Артёма (2026-10-29): платную модель (Haiku) не берём. Ядро — детерминированный скоринг игр БЭКЛОГА по истории. Бесплатный LLM (free tier) только переформулирует готовые факты скоринга в 1–2 фразы и никогда не выбирает и не называет игры сам. Сбой, лимит или отсутствие ключа LLM → шаблонная причина из скоринга. Советы по играм вне библиотеки (каталог) не входят. Настроение из черновика v2 не берём: вкус задают жанровые сигналы, запрос только по времени.

Весь раздел под сессией (`src/proxy.ts`). Мутации требуют `Content-Type: application/json` и проверку `Origin` (3.4). Ответы в конверте 4.1.

### 18.1 Схема (миграция `0010_recommend`, только добавляет)
**`recommend_dislikes`**: `game_id` integer PK, FK `games.id` ON DELETE CASCADE; `created_at` timestamptz default now(). Игра в таблице не попадает в рекомендации.
**`recommend_reasons`** (кэш фраз LLM): `game_id` integer FK `games.id` ON DELETE CASCADE, `signals_hash` text, `text` text (1..400), `created_at` timestamptz default now(); PK `(game_id, signals_hash)`. Хэш считается от округлённых сигналов, поэтому фраза живёт, пока сигналы не изменились; запись старше 7 суток игнорируется.
**`recommend_llm_usage`**: `day` date PK (по МСК), `calls` integer not null default 0 (CHECK `>= 0`).

### 18.2 Переменные окружения (необязательные, только сервер, в `.env.example`)
- `LLM_PROVIDER`: `gemini` | `groq` | пусто (= LLM выключен).
- `LLM_API_KEY`: ключ провайдера. Не логируется и не попадает в ответы и `details`.
- `LLM_DAILY_LIMIT`: потолок вызовов в сутки МСК, по умолчанию 60 (с 20.4 W-3; раньше 20), диапазон 0..200 (0 = выключен). С Этапа 5 это общий предохранитель на все виды вызовов (20.4).
- `LLM_MODEL`: необязательно, модель провайдера (по умолчанию `gemini-2.5-flash-lite` / `llama-3.1-8b-instant`); нужна, чтобы сменить устаревшую модель без правки кода. Допустимы символы `[\w.:/-]`, иначе игнорируется.
Без ключа или провайдера всё работает на шаблонах (`meta.llm = "disabled"`).

### 18.3 Скоринг (`src/server/recommend/score.ts`, чистая функция, без env/БД/сети)
Кандидаты: игры со статусом `backlog`, `hidden_at` is null, не в `recommend_dislikes`. Статус `service` не участвует.
Балл = сумма взвешенных сигналов, каждый в диапазоне `[-1, 1]`, веса — константы в одном месте и покрыты тестами:
- `genre_affinity` (вес 3): для жанров игры (`genres_override` приоритетнее `psn_genres`, словарь из `src/shared`, игра делится по 1/N) считается `часы_жанра_в_играх_completed+playing` и `доля completed − доля dropped` по жанру, нормируется по библиотеке. Нет истории по жанру → 0.
- `duration_fit` (вес 2): по запросу `time`; часы = ОСТАТОК (Фаза 32, D3, 17.4): `max(база − наиграно, 15% базы)`, база = `duration_override_hours` > `hltb_main_hours`, наиграно = часы игры; функция `remainingHours` из `src/shared/remaining.ts`. Игра, которую уже начали, попадает в `short`/`medium` по тому, сколько ей осталось, а не по полной длительности. Окна: `short` ≤ 8 ч, `medium` 8..30 ч, `long` > 30 ч, `any` = сигнал 0. Попадание в окно +1, промах линейно к −1. Нет часов → 0 и пометка «длительность неизвестна».
- `platinum_close` (вес 1.5): доля уже полученных трофеев набора (если игра в бэклоге, но начата) ; нет трофейного набора → 0.
- `waiting` (вес 1): давность `game_status.status_changed_at` в бэклоге, насыщается на 365 днях.
- `dropped_genre_penalty` (вес −2): жанры, у которых доля dropped > 50% при ≥ 3 играх.
Тай-брейк: `game.id` asc. Одинаковый вход даёт одинаковый выход (детерминизм, Date.now не используется внутри — «сейчас» передаётся аргументом).
Выход: топ-3 (меньше, если кандидатов меньше) с `signals` (ключ, подпись RU, вклад в балл).

### 18.4 `GET /api/recommend?time=any|short|medium|long`
**Фаза 16.4 (20.4):** LLM на экране больше не вызывается, фразы читаются из кэша, который наполняет синк; пункты про вызов LLM, лимит и `meta.llm = limit/error` ниже заменены 20.4.

`time` по умолчанию `any`; иное значение → `400 invalid_request`.
```json
{ "ok": true, "data": {
  "items": [ {
    "game": { "id": 41, "name": "Hades", "imageUrl": "https://...", "bannerUrl": null, "genres": ["ACTION"], "hours": 22.5, "hoursSource": "hltb" },
    "score": 4.7,
    "signals": [ { "key": "genre_affinity", "label": "Любимый жанр: 120 ч, 80% пройдено", "contribution": 2.4 } ],
    "reason": { "text": "Тебе заходит экшен, и на неё уйдёт около 22 часов.", "source": "template" }
  } ],
  "meta": { "llm": "disabled", "candidates": 37, "time": "any" }
} }
```
- `game.hours` (Фаза 32) = остаток часов (18.3), `hoursSource` его база; необязательное `game.totalHours` = полная база (override/HLTB) или `null`.
- `reason.source`: `llm` | `template`. `meta.llm`: `ok` | `disabled` | `limit` | `error`.
- Пустой бэклог или всё в дизлайках: `items: []`, `meta.candidates: 0`, `200`.
- LLM вызывается не более одного раза за запрос (одна пачка из топ-3), таймаут 5 с, только для игр без свежей записи в `recommend_reasons`; успешный ответ кэшируется. Каждый реальный вызов увеличивает `recommend_llm_usage.calls`; при достижении `LLM_DAILY_LIMIT` → `meta.llm = "limit"`, шаблоны.
- В LLM уходят только названия кандидатов, жанры, часы и подписи сигналов. Не уходят: токены, NPSSO, email, чужие данные. Ответ LLM проходит проверку: длина 1..400, без ссылок, ровно по одной фразе на `game.id`; нарушение → шаблон для этой игры.
- Ошибки: `400 invalid_request`, `503 db_unavailable`. Сбой LLM не даёт ошибку, а только `meta.llm = "error"`.

### 18.5 `POST /api/recommend/dislike` / `DELETE /api/recommend/dislike/:gameId`
`POST` тело `{ "gameId": 41 }` → `200 { "ok": true, "data": { "gameId": 41 } }`, идемпотентно (повтор не ошибка). `DELETE` снимает отметку, идемпотентно. Ошибки: `400 invalid_request`, `404 not_found` (нет такой игры в `games`), `503 db_unavailable`.

### 18.6 Действия на экране
«Начать играть» использует существующее изменение статуса (раздел 9), отдельного эндпоинта нет. «Не интересно» — 18.5. После обоих frontend перезапрашивает `GET /api/recommend`.

### 18.7 Применение 0010 на Neon
`docs/release-neon-0010.sql`: идемпотентный (`CREATE TABLE IF NOT EXISTS`, FK через проверку `pg_constraint`), запись в журнал drizzle, проверочный `SELECT`. Только создаёт три таблицы. Применять ДО деплоя кода: без таблиц `GET /api/recommend` отвечает `503 db_unavailable`.

### 18.8 Уточнения реализации (Фаза 13, backend)
**Фаза 16.4:** хэш кэша (`stableHash`), срок кэша, счёт неудачных вызовов и атомарный лимит заменены в 20.4.

- Формулы: `genre_affinity` жанра = `0.6 * часы_жанра/макс_часы_по_библиотеке + 0.4 * (completed − dropped)/(completed + dropped)` (доли по 1/N), значение игры = среднее по её жанрам. `dropped_genre_penalty`: значение сигнала в `[0, 1]` (доля штрафуемых жанров игры), вклад = `−2 * значение`; «≥ 3 игр» считается по играм `completed` + `dropped` в жанре. `duration_fit`: промах доходит до −1 на 20 ч мимо окна. `platinum_close`: `earned/total` по всем привязанным трофейным наборам, только если `earned > 0`; наличие невыполненных трофеев DLC-групп (`group_id` не `default`) вдвое снижает значение. История вкуса не включает скрытые игры.
- `signals` содержит только ненулевые вклады плюс пометку `duration_fit` «Длительность неизвестна» (вклад 0, только при `time` ≠ `any`). Порядок: по убыванию |вклад|, затем по ключу. `score` и `contribution` округлены до 0.01.
- Хэш кэша фраз: sha256 от id, названия, жанров, часов (целые) и пар (ключ сигнала, вклад, округлённый до 0.5). Кэш-попадание на всю тройку даёт `meta.llm = "ok"` без вызова провайдера.
- Если часть фраз ответа LLM не прошла проверку, `meta.llm = "ok"`, невалидные игры получают шаблон и не кэшируются; если не прошла ни одна или ответ не разобран, `meta.llm = "error"`. Недоступность таблиц кэша/счётчика при живой основной БД даёт `meta.llm = "error"` и шаблоны.
- Вызов засчитывается в `recommend_llm_usage` до обращения к провайдеру (атомарный `INSERT ... ON CONFLICT DO UPDATE ... WHERE calls < limit`), поэтому неудачный вызов тоже расходует лимит.
- Проверка фразы дополнительно отбрасывает упоминание названия другой игры из той же пачки.
- Проверка ссылок (после QA N-2): отбрасывается любой латинский токен вида `слово.tld` (tld от 2 букв, без пробела вокруг точки), в т.ч. `bit.ly`, `goo.gl`, `evil.co`; плюс `http(s):`, `www.`, markdown и html. Точка в конце предложения, числа (`1.5`, `v1.2`) и кириллица не задеваются.

### 18.9 Правки после QA Фазы 13 (решения Артёма 2026-10-29): 9 карточек, скрытие «на сейчас», блок «Скрытые»
Миграции нет (используется существующий `recommend_dislikes.created_at`).
- **Размер выдачи.** `TOP_N = 9` вместо 3 (3 колонки × 3 ряда на десктопе). Все остальные правила 18.3/18.4 прежние; фразы LLM по-прежнему одной пачкой (до 9 игр), шаблон — фолбэк для каждой отдельно. Хэш кэша и лимит не меняются.
- **Скрытие «на сейчас».** Дизлайк действует `DISLIKE_TTL_DAYS = 30` суток от `created_at` (константа в `src/shared`, чистая, чтобы UI показывал срок). Истёкшая отметка игнорируется в скоринге и в списке скрытых (строку можно не удалять). Повторный `POST /api/recommend/dislike` на уже скрытую игру ОБНОВЛЯЕТ `created_at = now()` (продлевает срок), остаётся идемпотентным по смыслу. Дополнительно: отметка сбрасывается, когда игра ушла из `backlog` (в скоринге учитывается только дизлайк игры, которая сейчас в бэклоге и не скрыта `hidden_at`; при возврате в бэклог ранее истёкшая или оставшаяся отметка не должна «воскрешаться» навсегда — достаточно TTL, отдельная очистка по смене статуса не нужна).
- **`GET /api/recommend/dislikes`** → `200`:
```json
{ "ok": true, "data": { "items": [
  { "game": { "id": 41, "name": "Hades", "imageUrl": "https://...", "bannerUrl": null, "genres": ["ACTION"] },
    "hiddenAt": "2026-10-29T10:00:00.000Z", "expiresAt": "2026-11-28T10:00:00.000Z" } ],
  "ttlDays": 30 } }
```
Только неистёкшие отметки игр, которые сейчас в `backlog` и не скрыты `hidden_at`; порядок `hiddenAt` desc, затем `game.id`. Пустой список = `items: []`. Ошибки: `503 db_unavailable`.
- Возврат: существующий `DELETE /api/recommend/dislike/:gameId` (идемпотентный). После него frontend перезапрашивает `GET /api/recommend` и список скрытых.
- **UI** (оркестратор, на спеку designer эта правка накладывается без отдельного раунда): под сеткой рекомендаций сворачиваемый блок «Скрытые на сейчас · N» (закрыт по умолчанию, N = длина списка; при 0 блока нет). Строка: мини-обложка, название, «вернётся через N дн.», кнопка «Вернуть». Подпись при скрытии/в тосте: «Скрыто на 30 дней». Состояние «все скрыты» ведёт на этот блок (вместо «Вернуть скрытые: N» только на сессию). Сессионный тост «Отменить» остаётся.

## 19. «Подскажи»: два режима, «Новое от ИИ» через Groq + RAWG (Фаза 13b) — УДАЛЕНО 2026-10-31

> **Раздел удалён по решению Артёма (2026-10-31).** Модуль «Новое от ИИ» убран целиком: нет `GET /api/recommend/discover`, `POST|DELETE /api/recommend/discover/dislike*`, `GET /api/recommend/discover/dislikes` (роуты удалены, ответ 404), нет шага генерации в синке (`llm_discover_failed` больше не пишется, `LlmStepResult.discover` убран), нет видов бюджета `discover_auto` и `discover_manual` (в коде остался только `phrases`, потолок 8 в сутки; общий и пользовательский потолки считаются как раньше). «Подскажи» из бэклога (раздел 18, фразы LLM) и RAWG-каталог для Плана/релизов не затронуты.
> **Неиспользуемые остатки БД (миграций нет, данные не трогаем):** таблицы `recommend_discover_cache` и `recommend_external_dislikes`; колонки `recommend_llm_usage.discover_auto_calls` и `discover_manual_calls` (всегда 0, остаются в схеме Drizzle). Backup/restore их никогда не содержали (формат раздела 20 не менялся), старые копии восстанавливаются как раньше. Удаление таблиц возможно отдельной миграцией с согласием Артёма.
> Текст ниже сохранён как историческая справка и **не действует**; разделы 20.4–20.6 и 22 в частях про `discover*` тоже неактуальны.

Решение Артёма (2026-10-29): экран «Подскажи» делится на два режима.
1. **Из бэклога** — раздел 18, без изменений (только игры бэклога, скоринг, LLM по желанию формулирует причину).
2. **Новое от ИИ** — игры, которых нет в библиотеке. Groq предлагает названия по профилю вкуса, RAWG подтверждает существование и платформу PlayStation. Только Groq (`LLM_PROVIDER=groq`), другие провайдеры в этом режиме не используются.

Это пересматривает прежнее «вне MVP» для внешних советов (CLAUDE.md обновить). Жанры игр библиотеки по-прежнему только из PSN; RAWG тут источник карточек новинок и обложек.

Принципы защиты от выдумок: модель выдаёт только `title`, `year` и короткую причину; существование, обложка, дата, платформы берутся ТОЛЬКО из RAWG. Название, которое RAWG не подтвердил, на экран не попадает. Весь раздел под сессией; мутации с Origin и `Content-Type: application/json`; конверт 4.1.

### 19.1 Схема (миграция `0011_recommend_discover`, только добавляет)
**`recommend_discover_cache`**: `day` date PK (сутки МСК); `profile_hash` text not null; `payload` jsonb not null (объект `{ "proposed": число, "candidates": [ { externalSource, externalId, title, releaseDate, coverUrl, platforms, reason } ] }`: подтверждённые кандидаты со своими причинами, до 15 штук, до фильтра владения/скрытия; `proposed` = сколько валидных названий предложила модель); `refreshes` integer not null default 0 (CHECK `>= 0`; сколько раз за сутки сработал `?refresh=1`, нужен для лимита 3 в сутки); `created_at` timestamptz default now().
**`recommend_external_dislikes`**: `external_source` text (CHECK `= 'rawg'`), `external_id` text, `title` text not null (1..200), `cover_url` text null, `created_at` timestamptz default now(); PK `(external_source, external_id)`. Срок действия тот же, что у 18.9 (`DISLIKE_TTL_DAYS`), продлевается повторным POST.
Применение: `docs/release-neon-0011.sql` (идемпотентный, как 18.7). Без таблиц режим отвечает `503 db_unavailable`.

### 19.2 Переменные окружения
Новых нет. Режим доступен, только если `LLM_PROVIDER=groq` и задан `LLM_API_KEY`, и задан `RAWG_API_KEY`. Иначе `200` с `items: []` и `meta.llm = "disabled"` или `meta.catalog = "unavailable"` (экран объясняет, что настроить). Шаблонной замены нет: источник идей — модель.

### 19.3 Профиль вкуса (`src/server/recommend/profile.ts`, чистая функция)
Вход: игры с историей. Выход, который уходит в Groq (только это):
- до 15 игр с наибольшими часами среди `completed|playing` (название, часы);
- до 10 последних `completed` (названия);
- до 8 `dropped` (названия) как антипредпочтения;
- 5 жанров с наибольшим аффинити и жанры с высокой долей `dropped` (RU-подписи из `src/shared`);
- платформа: PlayStation.
Не уходят: `service`, скрытые (`hidden_at`), токены, NPSSO, email, id, даты, трофеи. `profile_hash` = sha256 от округлённого профиля.

### 19.4 Генерация (`src/server/recommend/discover.ts`)
**Фаза 16.4 (20.6):** GET без `refresh` не вызывает Groq; 12 игр, `reason` до 120, `max_tokens` 4000; счётчики и пауза по 20.4. Цифры «15» и «200» ниже устарели.

1. Если для текущих суток МСК есть кэш с тем же `profile_hash` — берём его, LLM не вызываем. `?refresh=1` игнорирует кэш, но не чаще 3 раз в сутки (иначе `meta.refreshLeft = 0` и кэш) и расходует `LLM_DAILY_LIMIT` как обычный вызов.
2. Запрос в Groq (`response_format: json_object`, температура ≤ 0.7, таймаут 15 с, `LLM_MAX_OUTPUT_TOKENS`): просит РОВНО 15 реально существующих игр на PlayStation, НЕ из переданного списка, формат `{ "games": [ { "title": str, "year": int|null, "reason": str<=200 } ] }`. Ответ парсится и валидируется: до 15 элементов, `title` 1..120, без ссылок (правило 18.8), `reason` 1..200 без ссылок; нарушающие элементы отбрасываются.
3. Подтверждение в RAWG для каждого названия: `searchCatalog(title, { playstationOnly: true })` (существующий клиент, раздел 17.9), до 3 параллельно, общий бюджет 20 с. Кандидат принимается, если нормализованное название результата равно предложенному (нижний регистр, без знаков и артиклей, «ё»=«е», римские/арабские цифры не сравниваются) ИЛИ сходство строк ≥ 0.9, и (если год известен и у RAWG есть дата) `|год − годРелиза| ≤ 1`. Берётся первый подходящий результат. Нет совпадения → кандидат отбрасывается.
4. Успешный результат пишется в `recommend_discover_cache` (если подтверждено ≥ 1 игра; иначе не кэшируем, чтобы не залипнуть на пустом).
5. Каждая реальная попытка вызова Groq списывает лимит (`reserveLlmCall`, как 18.4); при исчерпании → `meta.llm = "limit"`, отдаём последний кэш за любые сутки, если он есть, иначе `items: []`.

### 19.5 Фильтрация при выдаче (на каждый `GET`, без LLM)
Из кэшированных кандидатов убираются: уже в библиотеке (нормализованное совпадение с `games.name` и `games.hltb_name`, любой статус, включая скрытые игры), уже в `planned_games` в статусах `planned|done` (`cancelled` остаётся доступным), и скрытые в `recommend_external_dislikes` (неистёкшие). Отдаётся до 9 штук в порядке ответа модели.

### 19.6 `GET /api/recommend/discover[?refresh=1]`
**Фаза 16.4:** новые значения `meta.llmReason`: `truncated`, `paused`, `not_generated` (20.6).

```json
{ "ok": true, "data": {
  "items": [ {
    "externalSource": "rawg", "externalId": "3328", "title": "The Witcher 3: Wild Hunt", "releaseDate": "2015-05-18",
    "coverUrl": "https://media.rawg.io/...", "platforms": ["PlayStation 5", "PlayStation 4"],
    "reason": "Тебе заходят большие сюжетные RPG: на неё уйдёт около 50 часов.",
    "planned": false, "plannedId": null
  } ],
  "meta": { "llm": "ok", "llmReason": null, "catalog": "ok", "cached": true, "generatedAt": "2026-10-29T10:00:00.000Z", "refreshLeft": 3, "verified": 11, "proposed": 15 }
} }
```
- `meta.llm`: `ok` | `disabled` | `limit` | `error`; `meta.catalog`: `ok` | `unavailable` (нет ключа или RAWG не отвечает: подтвердить нельзя → ничего не показываем, не кэшируем).
- `planned`/`plannedId`: запись в `planned_games` с этим `externalSource+externalId` (любой статус); см. 17.13.
- `meta.llmReason`: `string | null`, машинная причина сбоя, не показывается как есть (диагностика). Не `null` при `llm = "error"` и при пустом результате после неудачи: `http_<статус>` или `http_<статус>:<error.code|error.type Groq>` (например `http_401`, `http_400:model_not_found`), `timeout`, `network`, `bad_response`, `empty_proposals` (Groq вернул 0 валидных игр), `no_verified` (RAWG ничего не подтвердил), `rawg_unavailable`. Остальные случаи (`ok`, `disabled`, `limit`) = `null`.
- Пустой результат — `200` с `items: []`; причину читаем из `meta`.
- Ошибки: `400 invalid_request` (неверный `refresh`), `503 db_unavailable`. Сбои Groq/RAWG — не ошибка HTTP, а `meta`.
- Время ответа без кэша до ~35 с: для маршрута `maxDuration` = 60.

### 19.7 «Не интересно» для внешних игр
- `POST /api/recommend/discover/dislike`, тело `{ "externalSource": "rawg", "externalId": "3328", "title": "...", "coverUrl": "https://..."|null }`. Идемпотентно, повтор продлевает срок. `200 { ok, data: { externalId } }`. Ошибки: `400`, `503`.
- `DELETE /api/recommend/discover/dislike/:externalId` (источник всегда `rawg`), идемпотентно.
- `GET /api/recommend/discover/dislikes` → `{ items: [ { externalSource, externalId, title, coverUrl, hiddenAt, expiresAt } ], ttlDays }`, неистёкшие, `hiddenAt` desc.

### 19.8 «В план»
Существующий `POST /api/roadmap/planned` (17.7) с `externalSource: "rawg"`, `externalId`, `title`, `releaseDate`, `coverUrl`. Дубль → `409 planned_duplicate` (frontend трактует как «уже в плане»). Часы вводятся на экране «План» (как для всех релизов). Отдельного эндпоинта нет.

### 19.9 Безопасность и приватность
- Ключи (`LLM_API_KEY`, `RAWG_API_KEY`) не попадают в логи, ответы, `details`, кэш.
- В Groq уходит только профиль 19.3 (названия игр из собственной библиотеки и RU-подписи жанров).
- Названия из ответа модели не доверяются: они идут в RAWG как поисковая строка (URL-кодирование), на экран попадают только данные RAWG и `reason` после валидации. `reason` рисуется как обычный текст.
- Подпись источника на экране: «Подобрано ИИ, данные RAWG».

### 19.10 Уточнения реализации (Фаза 13b, backend)
- **Счётчик refresh.** В 19.1 добавлена колонка `recommend_discover_cache.refreshes` (в схеме её не было, а лимит «≤ 3/сутки» негде хранить). Растёт на 1 при записи нового кэша по `?refresh=1`, если кэш за эти сутки уже был; `refresh=1` без кэша за сутки = обычная генерация (не считается). `meta.refreshLeft = 3 − refreshes`. При исчерпании `?refresh=1` отдаёт кэш без вызова Groq. Смена `profile_hash` внутри суток пересоздаёт кэш (это не refresh, `refreshes` сохраняется).
- **Включённость.** Нет Groq (`LLM_PROVIDER` не `groq`, нет ключа, `LLM_DAILY_LIMIT=0`) → `items: []`, `llm: "disabled"`. Нет `RAWG_API_KEY` → `items: []`, `catalog: "unavailable"`, `llm: "ok"`. В обоих случаях сеть не вызывается и кэш не читается для выдачи.
- **Фолбэк на старый кэш.** Помимо `limit` (19.4 п.5) последний кэш за любые сутки отдаётся и при `llm: "error"` (сбой, таймаут, мусор от Groq) и при `catalog: "unavailable"` (ни один поиск RAWG не удался). Кэша нет → `items: []`. Новый результат при этом не пишется. Если часть поисков RAWG упала или не уложилась в бюджет, кэшируется то, что подтвердилось (≥ 1).
- **Матчер.** К правилу 19.4 п.3 добавлено: сходство ≥ 0.9 засчитывается, только если совпадают наборы номеров частей (арабские и римские токены `ii..xv`), иначе «Resident Evil 2» и «Resident Evil 3» (сходство 0.93) слиплись бы. Сами цифры по-прежнему не переводятся друг в друга. Результат RAWG без платформы PlayStation (`slug` на `playstation`) не принимается, даже если вернулся при фильтре.
- **Фильтр 19.5.** Совпадение с `planned_games` (`planned|done`) проверяется по `externalId` и по нормализованному названию (чтобы закрыть релизы, добавленные вручную). `planned/plannedId` заполняются по `externalId` для любого статуса.
- **Пример выдачи.** `meta.verified` и `meta.proposed` берутся из кэша (до фильтра владения), а не из длины `items`.
- **Валидация `POST /discover/dislike`.** `externalSource` только `"rawg"`, `externalId` 1..64 без пробелов и `/ ? # % \`, `title` 1..200, `coverUrl` https до 2048 или `null` (обязательное поле, `null` допустим). Лишние поля = `400`. `DELETE` не проверяет существование отметки.
- **Профиль.** Часы в `profile_hash` округляются до 10, чтобы дневной прирост часов не сбрасывал кэш. Названия из библиотеки очищаются от управляющих символов и режутся до 80 символов; системный промпт объявляет профиль данными, а не инструкциями.
- **`refresh`.** `GET ?refresh=` принимает `1|true` (обновить) и `0|false` (как без параметра), остальное (в т.ч. пусто) = `400`.
- **Атомарность refresh и пауза после неудачи.** `?refresh=1` занимает слот (`UPDATE ... SET refreshes = refreshes + 1 WHERE day = ? AND refreshes < 3 RETURNING`) до вызова Groq, при `limit` слот возвращается. После неудачной генерации (ошибка Groq, 0 подтверждённых, RAWG недоступен целиком) Groq 10 минут не вызывается: отдаётся последний кэш или пусто с `meta.llm = "error"`; время неудачи хранится в служебной строке `recommend_discover_cache` с `day = '1970-01-01'` (без миграции; в выдачу и фолбэк не попадает).
- **Диагностика `llmReason`.** Значение символов только `[a-z0-9_.:-]`; из ответа Groq берутся лишь HTTP-статус и очищенные до `[a-z0-9_.-]{1,40}` `error.code`/`error.type`, тела ответов, ключи и промпт не сохраняются и не логируются. При неудаче пишется одна строка `console.warn('[recommend/discover] ' + reason)`. Причина хранится в служебной строке паузы D3 (`payload.reason` рядом с `failedAt`), поэтому в течение 10 минут `meta.llmReason` показывает прежнюю причину (повторного warn нет).

## 20. Этап 5: надёжность, резервная копия, расход LLM, данные на экранах (Фазы 16–17)

Решения Артёма 2026-10-29 (`plan.md`, Этап 5): HLTB у всех, кроме игр-сервисов; алерт «синк не запускался» в Telegram; резервная копия разметки раз в неделю; сократить расход LLM. Раздел перекрывает прежние формулировки в 16.6, 16.7, 18.4, 18.8, 19.4, 19.6, 19.10 там, где они противоречат (в этих местах стоят пометки «см. 20.x»). Весь раздел под сессией (`src/proxy.ts`), кроме `/api/cron/*` (Bearer `CRON_SECRET`). Мутации: `Content-Type: application/json` и проверка `Origin` (3.4). Ответы в конверте 4.1, кроме скачивания файла (20.3).

### 20.1 HLTB у всех, кроме `service` (16.1)
Правило отбора шага синка (16.6) и массового запуска (16.7) меняется: видимые игры без `duration_override_hours`, у которых статус ЛЮБОЙ, кроме `service` (то есть `backlog`, `playing`, `shelved`, `completed`, `dropped` и «без статуса»), и `hltb_checked_at` NULL или старше 30 дней (плюс перепроверка `recheckNotFound` из 16.7). Игры-сервисы не проверяются никогда. Порядок: `backlog`, `playing`, `shelved`, без статуса, `completed`, `dropped`, затем `id`. Остальное (пачка 20 за звено, пачки по 10 и бюджет 45 с у массового запуска, защиты `hltb_empty` и 3 ошибки подряд) не меняется. Схема и форма ответа `POST /api/hltb/run` прежние; `remaining` считается по новому правилу. Фронт вызывает эндпоинт в цикле, пока `done=false`; после `remaining=0` у каждой не-сервисной видимой игры `found` или `not_found`. Скрытые (`hidden_at`) игры по-прежнему не проверяются: их нет в списках, и счётчик `hltbCounts.unchecked` не считает игры с ручной длительностью и `service` (их шаг пропускает) и для видимой коллекции доходит до `0`; фильтр `hltb=unchecked` не менялся.

### 20.2 «Синк не запускался» (16.2)
- Порог `SYNC_OVERDUE_MS = 30 ч` (константа в `src/shared/sync.ts`, чистая, чтобы UI показывал тот же порог).
- Опорное время: `finished_at` (если нет, `started_at`) последнего `success` не-`hltb` запуска. Нет успешных, но были запуски: время первого запуска. Запусков нет совсем: проверка не срабатывает (`isOverdue=false`, `ageHours=null`).
- `GET /api/sync/status` (8.4) получает поле верхнего уровня `overdue`:
```json
"overdue": { "isOverdue": true, "ageHours": 53.2, "thresholdHours": 30 }
```
`ageHours` округлено до 0.1 или `null`. Остальные поля 8.4 без изменений. Баннер на сайте показывается при `overdue.isOverdue = true` и не заменяет баннер `psnAuth=auth_expired` (если оба, показывать оба или приоритетный по решению designer).
- Новый cron `GET /api/cron/watchdog` (Bearer `CRON_SECRET`, `maxDuration = 30`; с Фазы 29 `60`), расписание в `vercel.json` `0 6 * * *` (09:00 МСК; с Фазы 29 `0 16 * * *` = 19:00 МСК, см. F29.2; Hobby: 2 задания, раз в сутки). Выполняет две независимые проверки, сбой одной не мешает другой:
  1. Если `isOverdue` и задан Telegram, шлёт сообщение `sync_missed` («PS Tracker: синк не выполнялся успешно уже N ч (порог 30). Проверьте cron на Vercel и NPSSO.» + ссылка на инструкцию `docs/release.md`, раздел 3). Не чаще раза в сутки МСК (`notify_log.kind = 'sync_missed'`, как в 15.4). Фаза 18.7 (N-7): отметка «отправлено сегодня» ставится атомарно ДО отправки (`INSERT ... ON CONFLICT DO UPDATE ... WHERE sent_on < сегодня`), второй параллельный вызов получает `already_sent`; при неудачной отправке отметка откатывается, повтор возможен. Не отправляется, если сейчас идёт синк (`running`, старт не старше 2 ч).
  2. Еженедельная копия (20.3).
- Ответ `200`: `{"ok":true,"data":{"sync":{"isOverdue":false,"ageHours":10.1,"alert":"not_needed"},"backup":{"result":"not_due"}}}`. `sync.alert`: `not_needed | sent | already_sent | telegram_disabled | send_failed | sync_running | error`. `backup.result`: `not_due | sent | already_sent | telegram_disabled | send_failed | error`. Ошибка БД одной проверки даёт `error` в её поле, не `5xx`. Неверный Bearer: `401 unauthorized`.
- Существующий `sync_stale` (15.4, 3 суток, после завершения синка) остаётся как есть.

### 20.3 Резервная копия разметки (16.3)
**Файл** (версия схемы 1). Только ручные данные, невосстановимые из PSN; игры сопоставляются по `title_id` PSN, а не по внутреннему `id`. В файл попадают только игры, у которых есть хоть одно ручное поле.
```json
{
  "app": "ps-tracker-backup",
  "schemaVersion": 1,
  "createdAt": "2026-10-29T06:00:00.000Z",
  "games": [
    { "titleId": "PPSA01234_00", "name": "Hades",
      "status": { "value": "completed", "completedAt": "2026-03-02T19:10:00.000Z", "droppedAt": null, "statusChangedAt": "2026-03-02T19:11:00.000Z" },
      "durationOverrideHours": 22.5, "genresOverride": ["ACTION"], "hiddenAt": null,
      "roadmapPosition": 3, "roadmapExcluded": false, "monthExclusions": ["2026-03"] }
  ],
  "plannedGames": [ { "title": "GTA VI", "releaseDate": "2026-11-19", "coverUrl": null, "wantAtRelease": true, "hoursManual": 40, "externalSource": "rawg", "externalId": "123", "status": "planned" } ],
  "roadmapSettings": { "year": 2026, "hoursPerWeek": 8 }
}
```
- `games[].status` = `null`, если статуса нет; `genresOverride`/`durationOverrideHours`/`hiddenAt`/`roadmapPosition` = `null`, если не заданы. `roadmapSettings` = `null`, если строки нет. `name` только для чтения человеком (не используется при восстановлении).
- Что входит: `game_status` (включая ручные `completed_at`/`dropped_at`), `games.duration_override_hours`, `games.genres_override`, `games.hidden_at`, `roadmap_order`, `roadmap_excluded`, `game_month_exclusions`, `planned_games`, `roadmap_settings`. Не входят: игры, часы, снимки, трофеи (приходят из PSN), кэши «Подскажи», дизлайки (временные), токены и любые секреты.
- Размер: десятки КБ; лимиты при чтении: `games` до 5000, `plannedGames` до 2000, тело запроса восстановления до 5 МБ.

**Скачать.** `GET /api/backup` (сессия). Ответ `200`, тело = файл напрямую (НЕ в конверте), `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="ps-tracker-backup-YYYY-MM-DD.json"` (дата МСК), `Cache-Control: no-store`. Ошибка БД: `503 db_unavailable` (конверт).

**Восстановить.** (Фаза 18.7: дубли `roadmapPosition` внутри файла разводятся: игры с одинаковой позицией идут в порядке файла, каждая следующая получает позицию не меньше предыдущей + 1; без дублей позиции не меняются.) `POST /api/backup/restore`, тело `{ "mode": "preview" | "apply", "backup": <файл> }` (фронт читает файл, парсит JSON и кладёт объект в `backup`). Правила восстановления: ТОЛЬКО добавляет и перезаписывает значениями из файла, ничего не удаляет и не сбрасывает; поле, пустое (`null`) в файле, текущее значение не трогает; игры, которых нет в файле, не затрагиваются; `titleId`, которого нет в БД, пропускается и перечисляется в `missing`. Планируемые игры сопоставляются по `externalSource+externalId`, иначе по `lower(title)+releaseDate`; найденная обновляется, ненайденная создаётся. Месяцы-исключения, `roadmap_excluded` только добавляются. Скрытие игры (`hiddenAt`) ставится, если в файле задано. `preview` ничего не пишет и возвращает то, что изменит `apply` (ту же функцию плана). `apply` выполняется в одной транзакции под advisory lock; перед ним, если меняются статусы, ВСЕ текущие строки `game_status` сохраняются в `status_backups` (причина `before_file_restore`, хранятся последние `BACKUPS_KEEP` копий, общие с 9.8/9.9); id копии приходит в ответе `apply` как `backupId`, вернуть можно существующим `POST /api/games/status-restore` с этим `backupId` (кнопка «Вернуть статусы из копии» 9.9a показывает только копии `reset_all`, для копии восстановления отдельной кнопки нет).
```json
{ "ok": true, "data": {
  "mode": "preview", "applied": false, "schemaVersion": 1, "fileCreatedAt": "2026-10-29T06:00:00.000Z",
  "sections": {
    "status": { "add": 3, "change": 2, "unchanged": 100, "skipped": 1 },
    "duration": { "add": 0, "change": 1, "unchanged": 20, "skipped": 0 },
    "genres": { "add": 0, "change": 0, "unchanged": 4, "skipped": 0 },
    "hidden": { "add": 0, "change": 0, "unchanged": 2, "skipped": 0 },
    "roadmapOrder": { "add": 5, "change": 10, "unchanged": 40, "skipped": 0 },
    "roadmapExcluded": { "add": 0, "change": 0, "unchanged": 3, "skipped": 0 },
    "monthExclusions": { "add": 1, "change": 0, "unchanged": 6, "skipped": 0 },
    "plannedGames": { "add": 1, "change": 0, "unchanged": 4, "skipped": 0 },
    "roadmapSettings": { "add": 0, "change": 0, "unchanged": 1, "skipped": 0 }
  },
  "changes": [ { "section": "status", "kind": "change", "titleId": "PPSA01234_00", "name": "Hades", "from": "backlog", "to": "completed" } ],
  "changesTruncated": false,
  "missing": [ { "titleId": "CUSA99999_00", "name": "Old game" } ],
  "backupId": null
} }
```
- `add` = в БД ещё нет значения; `change` = есть другое; `unchanged` = совпадает; `skipped` = игра из файла не найдена в БД. Для `status` сравниваются значение, `completedAt`, `droppedAt` (`statusChangedAt` переносится, но различием не считается).
- `changes`: до 100 записей (приоритет: `status`, остальное по порядку секций), `changesTruncated=true`, если их больше; `from`/`to` короткие строки (`status`: значение статуса; `duration`: часы; `genres`: ключи через запятую; `hidden`: `visible`/`hidden`; `roadmapOrder`: позиция; `monthExclusions`/`roadmapExcluded`: `null` → `added`; `plannedGames`: название). `missing`: до 50.
- `apply` возвращает то же плюс `applied=true`, `backupId` (id копии в `status_backups` или `null`, если статусы не менялись).
- Ошибки: `400 invalid_request` с `details.reason`: `invalid_json`, `invalid_format` (не наш файл, нет `app`, нарушена схема; `details.path` первое проблемное поле), `unsupported_version` (`schemaVersion` не равна 1: `details.supported=[1]`, `details.got`), `too_large`; `400 invalid_request` с `details.reason = apply_failed` (ошибка данных внутри транзакции: нарушение CHECK/уникальности, SQLSTATE класса 22/23; ничего не изменено); `503 db_unavailable` (БД недоступна).
- Идемпотентность: повторный `apply` того же файла даёт нули в `add`/`change`. Дубли внутри файла (одинаковые `monthExclusions`, одинаковые `plannedGames` по ключу сопоставления) считаются один раз. Позиции `roadmap_order` остаются уникальными: игры из файла получают позиции файла, игры вне файла, чьи позиции совпали, сдвигаются после последней позиции файла с сохранением относительного порядка (эти сдвиги в `sections` не считаются).

**Еженедельная отправка.** `GET /api/cron/watchdog` (20.2) по воскресеньям МСК, а также если последняя копия старше 8 суток (догоняет пропущенное), присылает файл документом (`sendDocument`) с подписью «PS Tracker: резервная копия разметки, N игр». Дедуп: `notify_log.kind = 'backup_weekly'`, не чаще раза в сутки МСК, отметка атомарная до отправки с откатом при неудаче (как в 20.2, N-7). Нет Telegram: `telegram_disabled`, копию можно скачать вручную.

### 20.4 Расход LLM (16.4): изменения поведения
**Экран не вызывает LLM для фраз бэклога.** `GET /api/recommend` (18.4) только читает кэш `recommend_reasons`; фильтры времени и обновление страницы не создают вызовов. Фразы для всего бэклога создаёт шаг синка (20.5).
- Хэш кэша фразы (`stableHash`, замена `signalsHash` из 18.8): sha256 от `id`, названия, жанров, часов (целые) и пар (ключ, вклад, округлённый до 0.5) ТОЛЬКО стабильных сигналов `genre_affinity`, `platinum_close`, `dropped_genre_penalty`. Без `waiting` (давность растёт каждый день) и `duration_fit` (зависит от фильтра времени на экране). Срок 7 суток снят: фраза живёт, пока хэш не изменился (запись с другим хэшем игры заменяется при генерации новой).
- `GET /api/recommend`: у каждой карточки `reason.source = 'llm'`, если есть кэш по хэшу, иначе `'template'`. `meta.llm`: `disabled` (LLM выключен) или `ok` (включён; `limit`/`error` на экране больше не возникают). Новое поле `meta.llmPending`: число показанных карточек с шаблоном при включённом LLM (до ночного синка). Остальные поля 18.4 без изменений.
- Счётчики по суткам МСК (`recommend_llm_usage`, миграция `0012`): `calls` (всего за сутки, общий предохранитель `LLM_DAILY_LIMIT`, по умолчанию 20), `phrase_calls` (фразы бэклога, до 8 в сутки), `discover_auto_calls` (генерация «Нового от ИИ» в синке, до 1), `discover_manual_calls` (ручные обновления, до 3). Вызов занимается атомарно ДО обращения к провайдеру и условием `calls < LLM_DAILY_LIMIT` И `<вид> < потолок вида`. **Вызов возвращается только при сбое на стороне провайдера до ответа (ошибка Groq/Gemini, таймаут, мусор, `truncated`).** Если ответ Groq получен и разобран, вызов потрачен независимо от RAWG: `no_verified` и `rawg_unavailable` его не возвращают. Счётчик неудач подряд `fail_streak` растёт только от сбоев провайдера; `rawg_unavailable` его не сбрасывает и не увеличивает (сбрасывается ответом Groq при доступном RAWG). Ограничение при недоступном RAWG дают потолки видов (1 авто + 3 ручных в сутки). Ошибка записи в БД (кэш фраз и т.п.) не считается сбоем провайдера: вызов не возвращается, `fail_streak` не растёт, шаг пишет предупреждение `llm_phrases_failed` с причиной `db_error` и останавливает фразы. При паузе шаг синка не пробует «Новое от ИИ» (предупреждения нет).
- Пауза после неудач: счётчик подряд идущих неудач `recommend_llm_state.fail_streak` (одна строка `id = 1`; успех обнуляет). `fail_streak >= 3` = пауза: ни синк, ни ручное обновление LLM не вызывают, пока не начнётся следующий синк (любой запуск синка в начале LLM-шага обнуляет счётчик). При паузе ручное «Обновить» отдаёт кэш с `meta.llm = "error"`, `meta.llmReason = "paused"`.
- `LLM_DAILY_LIMIT` теперь общий предохранитель на все виды (типичный день: 4–5 вызовов фраз + 1 + до 3 ручных); `0` по-прежнему выключает LLM.
- Таймауты и токены: фразы пачкой до 16 игр, таймаут 12 с, `max_tokens` 3000; «Новое от ИИ» `max_tokens` 4000, таймаут 15 с.
- Обрезка: `finish_reason = "length"` (Groq) / `finishReason = "MAX_TOKENS"` (Gemini) = ошибка `truncated` (`LlmError.detail`), неудача по правилам выше; причина попадает в `meta.llmReason`.

### 20.5 Шаг синка «LLM» (16.4, пункты 1–3)
После шагов `tint` и `hltb` в конце успешного звена (как они, не фаза курсора; любая ошибка = предупреждение, итог запуска не меняется). Обнуляет `fail_streak`, затем:
1. **Фразы бэклога.** Кандидаты: видимый `backlog`, не в неистёкших дизлайках; скоринг `time = any`; нужны фразы тем играм, у которых нет записи с их `stableHash`. Пачки по `PHRASE_BATCH = 16` (≈64 игры = 4 вызова), каждая пачка один вызов, перед вызовом нужно ≥ 8 с бюджета звена. Остановка: пауза, исчерпан лимит, нет времени. Невалидные фразы пачки не кэшируются (шаблон), игра повторится в следующем синке. Нет LLM (`getLlmEnv() = null`): шаг пропускается.
2. **«Новое от ИИ» — УДАЛЕНО 2026-10-31, шаг в синке больше не выполняется.** (Было: если LLM = Groq, есть `RAWG_API_KEY` и кэша `recommend_discover_cache` за сегодняшние сутки МСК ещё нет: одна генерация (вид `discover_auto`). Кэш за сегодня есть: пропуск. Неудача: предупреждение `llm_discover_failed`, повтор только в следующем синке (и ручной кнопкой).)
3. Предупреждения шага: `llm_phrases_failed` (`LLM: фразы бэклога, ошибок N (<причина>)`). Причины: те же машинные коды, что `meta.llmReason`. Без ключей, тел ответов и промптов.

### 20.6 «Новое от ИИ» (16.4 п.3 и баг 13b) — УДАЛЕНО 2026-10-31 (см. раздел 19)
Замена 19.4 (п.1, 5), 19.6, 19.10 («Атомарность refresh», «Фолбэк»):
- `GET /api/recommend/discover` БЕЗ `refresh` не вызывает Groq никогда: отдаёт кэш за сегодня, иначе последний кэш за любые сутки, иначе `items: []` и `meta.llmReason = "not_generated"` (подборку создаст ночной синк или кнопка «Обновить»). `meta.llm = "ok"` (или `disabled`, если нет Groq; `meta.catalog = "unavailable"`, если нет `RAWG_API_KEY`; в обоих случаях ничего не читается и не вызывается, как в 19.10).
- `?refresh=1` = ручная генерация (вид `discover_manual`, до 3 в сутки): `meta.refreshLeft = 3 − discover_manual_calls за сегодня`; при `refreshLeft = 0` отдаётся кэш без вызова (`llm: "ok"`, `refreshLeft: 0`); при исчерпанном общем предохранителе `meta.llm = "limit"`; при паузе (20.4) `meta.llm = "error"`, `llmReason = "paused"`; сбой Groq: `llm: "error"`, `llmReason` из 19.6, отдаётся последний кэш, лимит возвращается. Успех пишет кэш за сегодня (профиль может отличаться от прежнего хэша: кэш заменяется). Колонка `recommend_discover_cache.refreshes` больше не используется (оставлена, значение не меняется).
- Служебная строка паузы 10 минут (`day = '1970-01-01'`, 19.10) больше не пишется; её роль выполняет пауза после 3 неудач подряд (20.4). Старая строка, если есть, игнорируется.
- Размер ответа Groq: `max_tokens = 4000`; просим РОВНО 12 игр (`MAX_PROPOSALS = 12`) с `reason` до 120 символов (`REASON_MAX = 120`). Кэш (19.1): до 12 подтверждённых.
- Новые значения `meta.llmReason`: `truncated`, `paused`, `not_generated`. При неудаче по-прежнему одна строка в лог `[recommend/discover] <причина>` (причина = код `finish_reason`-обрезки `truncated` или иной из 19.6).
- Фильтрация при выдаче 19.5 без изменений.

### 20.7 Аватар PSN (17.1)
Причина `avatarUrl = null`: `getProfileFromUserName` (`profile2`) отдаёт `avatarUrls[].avatarUrl` с адресами вида `http://static-resource.np.community.playstation.net/...`, а `httpsUrl` (правка BUG-P9-2) отбрасывала всё, кроме `https:`. Это гипотеза по коду и документации библиотеки; на живом ответе не проверялось (нет доступа к PSN), подтвердить после ближайшего синка по `GET /api/collection/summary` → `profile.avatarUrl`. Дополнительно: если `avatarUrls` пуст, берётся `personalDetail.profilePictureUrls[].profilePictureUrl`; если и там нет, клиент делает запасной запрос `getProfileFromAccountId` (`avatars[].url`; сбой игнорируется). Если аватара нет нигде, синк пишет предупреждение `avatar_missing` с безопасной диагностикой (наличие и тип полей, число элементов, размеры, схема и хост без пути и параметров). Исправление в `src/server/psn/mapping.ts`: для аватара `http://` на хостах `*.playstation.net` и `*.playstation.com` повышается до `https://`; остальные не-https адреса по-прежнему отбрасываются. Формат ответов не меняется. Прежнее значение в `psn_profile` не затирается пустым (11.1), следующий синк заполнит поле.

### 20.8 «Редкие трофеи» без игр-сервисов (17.2)
- `GET /api/stats` (10.1, 14.1) получает параметр `withService` (`1|true` включить, `0|false` или нет = выключено, иное = `400 invalid_request`). По умолчанию в `rareTrophies.period` и `rareTrophies.allTime` НЕ попадают трофеи, чья «игра сета» (14.1) имеет статус `service`; сироты и сеты игр без статуса остаются. С `withService=1` поведение прежнее. Прочие блоки статистики (трофеи периода, платины, топ игр по трофеям) параметром не затрагиваются.
- `GET /api/wrapped` (11.1): `trophies.rare` тоже без сервисов по умолчанию, тот же параметр `withService`.

### 20.9 Миграция `0012_llm_budget` (только добавляет)
`recommend_llm_usage`: колонки `phrase_calls`, `discover_auto_calls`, `discover_manual_calls` (integer not null default 0, CHECK `>= 0`). Новая таблица `recommend_llm_state`: `id` smallint PK (CHECK `= 1`), `fail_streak` integer not null default 0 (CHECK `>= 0`), `last_reason` text null, `updated_at` timestamptz default now(). Данные не теряются. Применение: `docs/release-neon-0012.sql` (идемпотентный, как 18.7), ДО деплоя кода: без таблицы и колонок `GET /api/recommend`, шаг синка LLM и discover `?refresh=1` ответят ошибкой БД (шаг синка только предупреждением). Остальные пункты раздела (20.1–20.3, 20.7, 20.8) миграции не требуют.

### 20.10 Переменные окружения
Новых нет. Изменён смысл `LLM_DAILY_LIMIT` (общий предохранитель, 20.4). `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` теперь используются также для алерта `sync_missed` и еженедельной копии; без них эти отправки `telegram_disabled`, остальное работает.

## 21. Заголовки безопасности (Фаза 19)

Источник: `src/shared/security-headers.ts`. Заголовки кроме CSP отдаёт `next.config.ts` (`headers()`, source `/:path*`: страницы, `/api/*`, manifest, иконки). CSP страниц и `/api/*` (включая 401/redirect) с nonce ставит `src/proxy.ts` (с хвоста 20.5). Файлы вне matcher proxy (manifest, иконки) получают в `next.config.ts` строгий `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`.

| Заголовок | Значение |
|---|---|
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| X-Frame-Options | `DENY` (и `frame-ancestors 'none'` в CSP) |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| Strict-Transport-Security | `max-age=31536000` (без includeSubDomains и preload: домен `*.vercel.app` не наш) |
| Content-Security-Policy | см. ниже |

CSP (enforce, не Report-Only): `default-src 'self'`; `script-src 'self' 'nonce-<на запрос>'` (без `'unsafe-inline'`); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `font-src 'self' data:` (next/font отдаёт шрифты с нашего origin); `connect-src 'self'` (браузер ходит только в наш API, PSN/RAWG/HLTB/Groq/Telegram вызывает сервер); `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests`. В dev добавляются `'unsafe-eval'` и `ws:`.

Nonce (хвост 20.5): `proxy.ts` на каждый запрос генерирует nonce (base64 от `crypto.randomUUID()`), кладёт CSP в ответ и в заголовки запроса (`Content-Security-Policy`, `x-nonce`); Next ставит nonce на свои inline-скрипты и теги `<script src>`, `src/app/layout.tsx` читает `x-nonce` и ставит его на inline-скрипт темы. Цена: все страницы и так динамические (корневой layout читает cookie темы), поэтому статического кэша HTML нет и терять нечего; `style-src 'unsafe-inline'` оставлен (inline-стили React и next/font). CSP без nonce (`buildCsp()` без аргументов) остаётся для тестов и отката. Ответ `/api/*` тоже несёт CSP с nonce (безвредно).

Тесты: `src/shared/security-headers.test.ts`, `src/proxy.test.ts` (nonce на каждом ответе, свой на запрос; Vitest), `e2e/security-headers.spec.ts` (заголовки на странице, /api 401, manifest, иконка; nonce совпадает с nonce inline-скриптов; тема под nonce; отсутствие CSP-нарушений в консоли).

## 22. Мультипользовательность (Фаза 20, подфаза 20.1)

Статус: 20.2 реализована (миграция `0013`, вход Google, `v:2`, «Доступ»); `0014` применена в проде (22.11); весь backend работает с обязательным `userId` (20.3, 22.12); `0015` (contract) готова к применению Артёмом (22.14). Заменяет 3.1 (один пароль) и расширяет 3.3, 3.4, 3.5, 4.2, 5, 6. Решения Артёма (2026-10-29/30): вход Google OAuth + белый список; `ADMIN_PASSWORD` остаётся аварийным входом owner; каждый видит только свою коллекцию; цель 4–10 человек на Vercel Hobby; общего каталога игр нет (всё дублируется на пользователя); один технический NPSSO читает всех; новые пользователи подключаются по открытому профилю PSN без дружбы (проверка доступа ещё идёт, см. 22.2 и план Б).

### 22.1 Таблицы: решение по каждой

`user_id integer not null references allowed_users(id) on delete cascade` во всех user-scoped таблицах. Потомки игр получают собственный `user_id` и составной FK `(user_id, game_id) -> games(user_id, id)` (в `games` добавляется `unique (user_id, id)`), чтобы строка другого пользователя не могла сослаться на чужую игру. `games.id` остаётся глобальным identity, поэтому PK таблиц `game_status`, `roadmap_order`, `roadmap_excluded`, `recommend_dislikes` не меняются.

| Таблица | Решение | Новые ключи / причина |
|---|---|---|
| `games` | user-scoped | `unique (user_id, title_id)` вместо `title_id`; индексы `concept_id`, `last_played_at` получают префикс `user_id`. Статусы, HLTB, жанры, скрытие у каждого свои |
| `game_status` | user-scoped | PK `game_id` без изменений, + `user_id`, составной FK, индекс `(user_id, status)` |
| `trophy_sets` | user-scoped | `earned_*`, `progress`, `trophies_synced_at` зависят от пользователя; `unique (user_id, np_communication_id)` |
| `game_trophy_sets` | user-scoped | PK `(user_id, game_id, trophy_set_id)`; FK на `trophy_sets` по `(user_id, id)` (там `unique (user_id, id)`) |
| `trophies` | user-scoped | `earned`/`earned_at` свои; `unique (user_id, trophy_set_id, trophy_id)` |
| `playtime_snapshots` | user-scoped | `unique (user_id, game_id, snapshot_date)`; индекс `(user_id, snapshot_date)` |
| `sync_runs` | user-scoped | каждый запуск относится к одному пользователю; индекс `(user_id, started_at desc)`. Частичный индекс «не больше одного `running`» остаётся глобальным (22.9): один NPSSO и лимиты PSN |
| `psn_profile` | user-scoped | одна строка на пользователя: ключ `user_id` (раньше `id = 1`) |
| `status_backups` | user-scoped | копия статусов одного пользователя; откат только своих |
| `game_month_exclusions` | user-scoped | PK `(user_id, game_id, month)` |
| `roadmap_settings` | user-scoped | одна строка на пользователя |
| `planned_games` | user-scoped | `unique (user_id, external_source, external_id)` where not null; индекс `(user_id, status)` |
| `roadmap_order` | user-scoped | PK `game_id`, + `user_id`; индекс `(user_id, position)` |
| `roadmap_excluded` | user-scoped | PK `game_id`, + `user_id` |
| `recommend_dislikes` | user-scoped | PK `game_id`, + `user_id` |
| `recommend_reasons` | user-scoped | PK `(user_id, game_id, signals_hash)` |
| `recommend_llm_usage` | user-scoped | PK `(user_id, day)`; лимит на пользователя, общий потолок `LLM_DAILY_LIMIT` = сумма по `day` |
| `recommend_discover_cache` | user-scoped | PK `(user_id, day)` (профиль вкуса личный) |
| `recommend_external_dislikes` | user-scoped | PK `(user_id, external_source, external_id)` |
| `psn_auth` | **глобальная singleton** | один технический NPSSO/refresh token на всех; не содержит данных пользователей |
| `recommend_llm_state` | **глобальная singleton** | `fail_streak` описывает доступность провайдера LLM, а не пользователя |
| `login_attempts` | **глобальная** | лимит по IP до того, как известен пользователь; добавляется `kind text not null default 'password' check in ('password','google')` |
| `notify_log` | **глобальная** | дедуп уведомлений владельцу; для пользовательских событий `kind` получает суффикс `:<user_id>` (например `sync_missed:3`); схема не меняется |
| `allowed_users` | **новая** | 22.2 |

Кэша RAWG в БД сейчас нет (запросы идут на лету), «общий кэш RAWG» из `plan.md` — только если появится позже; тогда он глобальный и без пользовательских данных.

### 22.2 Новые таблицы

Одна таблица `allowed_users` (отдельную `users` не вводим: пользователь существует только если он в белом списке, лишний JOIN и рассинхрон не нужны). `allowed_users.id` и есть `userId` во всей системе.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | `userId`. Owner создаётся первым и получает `id = 1` |
| `email` | text | нет | нормализован: trim + lower-case; точки Gmail не схлопываются |
| `role` | text | нет, default `member` | `owner` \| `member` |
| `status` | text | нет, default `invited` | `invited` (в списке, ещё не входил) \| `active` \| `blocked` |
| `google_sub` | text | да | привязывается при первом входе; дальше сверяется |
| `display_name` | text | да | из Google, только для показа |
| `psn_online_id` | text | да | PSN ID для синка; owner копирует из `PSN_TARGET_ONLINE_ID` |
| `psn_account_id` | text | да | accountId, найденный по `online_id` |
| `psn_access_mode` | text | нет, default `public` | `public` (открытый профиль) \| `friend` (план Б: дружба с техаккаунтом) |
| `psn_access_status` | text | нет, default `unchecked` | `unchecked` \| `ok` \| `private` (профиль/игры/трофеи закрыты) \| `not_found` \| `friend_required` (план Б, ждём принятия заявки) \| `unavailable` (ошибка PSN, повторить) |
| `psn_access_checked_at` | timestamptz | да | |
| `onboarded_at` | timestamptz | да | пользователь прошёл онбординг (первый синк завершён) |
| `last_login_at` | timestamptz | да | |
| `invited_by` | integer | да | FK `allowed_users(id)` on delete set null |
| `created_at`, `updated_at` | timestamptz | нет | |

Индексы и CHECK:
- `unique (email)` (хранится уже нормализованным).
- `unique (google_sub) where google_sub is not null`.
- Частичный `unique ((true)) where role = 'owner'`: ровно один owner.
- CHECK на `role`, `status`, `psn_access_mode`, `psn_access_status` (списки выше); `email ~ '^[^@\s]+@[^@\s]+$'` и `char_length(email) <= 254`; `role = 'owner' -> status <> 'blocked'`.
- `login_attempts.kind` (22.1).

Результат проверки «открытый профиль без дружбы» (вход для 22.9 и онбординга): если подтвердится, `psn_access_mode = 'public'` у всех и `friend_required` не используется. Если нет, включается план Б без смены схемы: переменная `PSN_NEW_USER_MODE=friend` ставит режим `friend` новым пользователям, онбординг показывает «Отправьте заявку в друзья аккаунту `<tech online id>`», статус `friend_required` до принятия заявки техаккаунтом (проверка при синке/по кнопке «Проверить снова»).

### 22.3 Сессия

| Поле | Значение |
|---|---|
| Cookie | `pst_session` (имя, атрибуты и `Max-Age` как в 3.1) |
| Формат | `<payload_b64url>.<signature_b64url>`, подпись HMAC-SHA256 `SESSION_SECRET` (без изменений) |
| Payload v2 | `{"v":2,"uid":<allowed_users.id>,"role":"owner"\|"member","amr":"google"\|"pwd","iat":..,"exp":..}` |
| Срок | 30 дней фиксированный, без продления |
| Совместимость | `verifySessionToken` принимает только `v:2`. Токен `v:1` (выдан до Фазы 20) не принимается с коммита после `0015` (контракт 22.12): пользователь попадает на `/login` и входит заново (Google или аварийный пароль owner). `createSessionToken` (v:1) удалён |
| Что проверяет `proxy.ts` | только подпись, срок и форму (без БД), как сейчас |
| Что проверяет route handler | `requireUser(req)` читает `allowed_users` по `uid`: строка есть и `status = 'active'`. `role` берётся **из БД**, а не из cookie (cookie-роль только подсказка UI). Блокировка и удаление действуют со следующего запроса |
| Аварийный вход | `POST /api/auth/login` (3.5) без изменений по контракту, но выдаёт `v:2` для owner с `amr = pwd`; owner = единственная строка `role = 'owner'`; если её нет или она `blocked`, ответ `401 invalid_credentials` |
| Отзыв | блокировка пользователя (мгновенно) или смена `SESSION_SECRET` (все) |

Неактивный `uid` (нет строки, `blocked`): `401 unauthorized`, cookie очищается.

### 22.4 Эндпоинты входа

Все пути ниже открыты в `proxy.ts` без сессии (добавляются к `/api/auth/login`, `/api/auth/logout`).

| Метод и путь | Поведение |
|---|---|
| `GET /api/auth/google?next=` | Проверка лимита (ниже). Генерирует `state` (32 случайных байта), `nonce`, PKCE `code_verifier` (S256). Ставит cookie `pst_oauth` (подписана `SESSION_SECRET`, содержит state, nonce, verifier, безопасный `next`; `HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=600`). 302 на `accounts.google.com` с `response_type=code`, `scope=openid email`, `redirect_uri=${APP_ORIGIN}/api/auth/google/callback`, `code_challenge`, `state`, `nonce`, `prompt=select_account`. `next` проходит `safeNext` |
| `GET /api/auth/google/callback?code=&state=` | 1) cookie `pst_oauth` есть, подпись верна, `state` совпадает (constant-time), иначе `oauth_failed`. 2) Cookie `pst_oauth` удаляется сразу (одноразовая). 3) Обмен `code` + `code_verifier` на токены на сервере (`client_secret` только сервер). 4) Проверка `id_token`: подпись (JWKS Google), `iss`, `aud = GOOGLE_CLIENT_ID`, `exp`, `nonce`, `email_verified = true`. 5) Поиск в `allowed_users` по `google_sub`, иначе по нормализованному `email` (привязка `google_sub`; если у строки другой `google_sub`, отказ). 6) Если строка есть и `status` в (`invited`,`active`): `invited -> active`, `last_login_at`, cookie `v:2`, 302 на `next` или `/`. 7) Иначе отказ |
| `POST /api/auth/logout` | без изменений (3.5) |
| `GET /api/auth/me` | требует сессию. 200 `{ "ok": true, "data": { "id", "email", "displayName", "role", "amr", "psn": { "onlineId", "accessMode", "accessStatus", "checkedAt" }, "onboardedAt" } }` |

Отказ без раскрытия: для email не из списка, `blocked`, неподтверждённого email и чужого `google_sub` ответ один и тот же: 302 на `/login?error=access_denied` (текст в UI: «Не удалось войти. Если вы ждёте доступ, обратитесь к владельцу»), одинаковое время ответа (все ветки проходят обмен `code` и проверку токена до сверки со списком). Ошибки протокола (нет cookie, state не совпал, ошибка Google, сеть): 302 на `/login?error=oauth_failed`. В ответах и логах нет email и причины отказа; причина пишется только в `login_attempts.kind` как неуспех. Токены Google не сохраняются (нужны только для разовой проверки личности).

Лимит попыток: по IP через `login_attempts` (`kind = 'google'`, `ip_hash` как в 3.3): **10 неуспехов за 15 минут** на IP (старт `GET /api/auth/google` и callback проверяют лимит; неуспехом считается любой отказ callback), глобально **40 неуспехов за час** для `kind = 'google'`. При превышении `429 rate_limited` + `Retry-After` для старта; для callback 302 на `/login?error=rate_limited`. Счётчики `password` и `google` независимы. Транзакция и advisory lock как в 3.3. Ошибка конфигурации (нет `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`APP_ORIGIN`): `/api/auth/google` отвечает `500 config_error`, вход паролем owner работает.

### 22.5 Эндпоинты «Доступ» (только owner)

Проверка роли по БД (22.3). Не owner: `403 forbidden`. Все изменения только JSON + проверка `Origin` (3.4).

| Метод и путь | Тело / ответ | Ошибки |
|---|---|---|
| `GET /api/access/users` | 200 `{ users: [{ id, email, displayName, role, status, psnOnlineId, psnAccessStatus, lastLoginAt, createdAt, gamesCount, lastSyncAt }] }`, порядок по `id` | 401, 403 |
| `POST /api/access/users` | `{ email, role?: "member" }` (создать owner этим путём нельзя). 201 `{ user }`, статус `invited` | 400 `invalid_request` (email), 403, 409 `user_exists`, 409 `user_limit` (активных и приглашённых не больше `MAX_USERS`, по умолчанию 10), 409 `multiuser_not_ready` (пока `MULTIUSER_ENABLED` не `1`, 22.8) |
| `PATCH /api/access/users/{id}` | `{ status?: "active"\|"blocked", psnAccessMode?: "public"\|"friend" }`. Блокировка: данные сохраняются, сессии перестают работать сразу. Разблокировка: `blocked -> active` (если ни разу не входил, `invited`) | 400, 403, 404, 409 `owner_protected` (owner нельзя блокировать) |
| `DELETE /api/access/users/{id}` | `{ confirmEmail }` совпадает с email. Удаляет пользователя и каскадом все его данные безвозвратно. Допустим только для `blocked` или `invited`. 200 `{ deleted: true }` | 400, 403, 404, 409 `owner_protected`, 409 `not_blocked`, 400 `confirm_mismatch` |

Роль пользователя после создания не меняется (смена `owner` вне контракта). Нельзя заблокировать или удалить самого себя. Любая запись в `allowed_users` пишется без логирования email в обезличенных логах приложения.

Дополнения к 4.2: `403 forbidden`; `409 user_exists`, `user_limit`, `owner_protected`, `not_blocked`, `multiuser_not_ready`; `400 confirm_mismatch`.

### 22.6 Слой запросов с обязательным `userId`

Реализация в 20.3 отличается от первоначального замысла (`src/server/scope/`), см. 22.12: репозитории не вводятся, обязательность `userId` обеспечена сигнатурами функций.

- Каждая функция, читающая или пишущая user-scoped таблицу, принимает `userId: UserId` вторым параметром (после `db`) и добавляет `user_id = $userId` в SELECT, UPDATE и DELETE; в INSERT и upsert `user_id` пишется явно, `ON CONFLICT` идёт по составным ключам из 22.1.
- `UserId` — branded-тип (`src/server/auth/user-id.ts`). Получают его из `requireUser(req)` (сессия), из строки БД (`sync_runs.user_id` для продолжения звена, `getOwnerUserId` для cron). `userId` из тела, query и path запроса не принимается никогда. Без значения `UserId` код не компилируется.
- Параметр `{id}` в путях (`/api/games/{id}`, `/api/roadmap/planned/{id}` и т.д.) проверяется как `where id = $id and user_id = $userId`; чужой id даёт `404 not_found`, не `403` (существование не раскрывается).
- Чистая статистика (`src/server/stats/`, `recommend/score`, `roadmap/plan`) принимает уже выбранные данные и `userId` не знает; выборка данных только функциями с `userId`.
- Тесты: `src/server/user-scope.test.ts` (статический скан исходников: файл с user-scoped таблицами обязан работать с `userId`), «blocked» (каждый `route.ts` без сессии даёт 401), утечки между двумя пользователями (`src/server/user-isolation.test.ts`). Правило ESLint запрещает импорт `@/db` из страниц и UI.
- Cron и синк: `GET /api/cron/sync` в 20.3 работает для владельца; обход активных пользователей (`status = 'active'`, `psn_access_status = 'ok'`, есть `psn_online_id`) по одному со своим `sync_runs` — 20.4, см. 22.13.

### 22.7 Миграция существующих данных на owner

Общие правила: перед `0014` обязательны свежая резервная копия разметки (20.3), ветка Neon на момент до миграции (6, п. 6–7), согласие Артёма. Применяет Артём или оркестратор по его согласию.

| Шаг | Что | Когда |
|---|---|---|
| 1 | **`0013_allowed_users`** (безопасная, только добавляет): `create table allowed_users` (22.2), `login_attempts.kind` с default. Существующие таблицы данных не затрагиваются, текущий код работает без изменений | сессия 2 |
| 2 | `npm run db:bootstrap-owner`: идемпотентно вставляет owner (`id = 1`, `role = owner`, `status = active`, `email = OWNER_EMAIL`, `psn_online_id = PSN_TARGET_ONLINE_ID`, `psn_access_status = ok`); если owner уже есть, ничего не меняет. После вставки и при существующем owner проверяет `owner.id = 1` (на него завязаны cookie `v:1` и backfill `0014`); иначе `exit 1` с сообщением без email. Вне SQL-миграции, чтобы e-mail не жил в репозитории. **Порядок выкладки строго: `0013` → `db:bootstrap-owner` → деплой кода**; деплой до bootstrap оставит `allowed_users` без owner и закроет вход всем | сессия 2 |
| 3 | Код сессии 2: вход Google, `v:2`, «Доступ». Данные ещё не user-scoped, `member` добавлять нельзя: `POST /api/access/users` отвечает `409 multiuser_not_ready`, пока `MULTIUSER_ENABLED` не `1` | сессия 2 |
| 4 | **`0014_user_id_expand`** (expand, без потери): во все user-scoped таблицы (22.1) `user_id integer not null default <owner id> references allowed_users(id) on delete cascade` (добавление с default = backfill на owner одним ALTER; `owner id` подставляется скриптом миграции из `allowed_users where role='owner'`, при отсутствии owner миграция падает). Добавляются новые составные unique/индексы/FK из 22.1 рядом со старыми (FK как `NOT VALID`, затем `VALIDATE`). Старые уникальные индексы и PK остаются, поэтому старый код продолжает работать | сессия 3 |
| 5 | Проверка: на каждой таблице `count(*)` до и после равны; `count(*) where user_id <> <owner id>` = 0; суммы `play_duration_seconds` по снимкам, количество `game_status` и `trophies` совпадают с контрольными значениями до миграции | сессия 3 |
| 6 | Выкладка кода со слоем `scope` (22.6), все API на `userId` | сессия 3 |
| 7 | **`0015_user_id_contract`**: снять `default` с `user_id`; удалить старые unique по `title_id` и `np_communication_id`, `(set,trophy)`, `(game,date)`, `planned_games_external_key`; PK шести таблиц с ключом не по `game_id` (`recommend_llm_usage`, `recommend_discover_cache`, `recommend_external_dislikes`, `recommend_reasons`, `psn_profile`, `roadmap_settings`) заменить на составные с `user_id` (у `psn_profile` и `roadmap_settings` PK = `user_id`); удалить индексы без префикса `user_id`, которые заменены префиксными (`games.concept_id`, `games.last_played_at` и т. д., список в 22.14); снять singleton CHECK (`id = 1`); колонки `id` у `psn_profile` и `roadmap_settings` удалить (`-- DATA LOSS: колонка id, значение всегда 1`). Требует согласия Артёма | сессия 3, после проверки `0014` в проде |
| 8 | `MULTIUSER_ENABLED=1` ставится только после `0015` и QA изоляции; затем можно добавлять `member` | после 20.5 |

Откат:
- `0013`: код сессии 2 откатывается деплоем предыдущей версии; `drop table allowed_users` и `drop column login_attempts.kind` безопасны (данных пользователей нет). Старые `v:1` cookie продолжают работать.
- `0014`: аддитивна, предыдущий код работает на новой схеме (колонки имеют default, старые индексы на месте). Откат = деплой предыдущей версии; колонки можно оставить. Полный откат схемы — `drop column user_id` отдельной миграцией (потери данных нет, пока пользователь один).
- `0015`: необратима по ограничениям. Откат = восстановление из ветки Neon/PITR, сделанной перед ней, плюс деплой предыдущей версии. Поэтому `0015` выкладывается отдельно от `0014`, после суток наблюдения.
- Ошибка в середине `0014`: миграция в одной транзакции (DDL Postgres транзакционный), частичного состояния нет.

### 22.8 Переменные окружения (дополнение к разделу 5)

| Переменная | Обяз. | Описание |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | да (для Google-входа) | уже в Vercel. Redirect URI в консоли Google: `${APP_ORIGIN}/api/auth/google/callback`. Секрет не логируется |
| `APP_ORIGIN` | да (с Фазы 20) | был необязательным (15.4); теперь задаёт `redirect_uri` и проверку `Origin`. **Должен быть единственным боевым доменом**: cookie `pst_oauth` ставится на хост начала входа, а callback идёт на `APP_ORIGIN`; вход с www/preview-хоста даст `oauth_failed` (корректный отказ, но неочевидный) |
| `OWNER_EMAIL` | для `db:bootstrap-owner` | email владельца (Google-аккаунт Артёма), только сервер/CI. **Порядок: `0013` → `db:bootstrap-owner` → деплой** (22.7); при `owner.id <> 1` скрипт падает |
| `MULTIUSER_ENABLED` | нет, `0` | `1` разрешает добавлять `member` (22.7, шаг 8) |
| `MAX_USERS` | нет, `10` | потолок `invited` + `active` |
| `PSN_NEW_USER_MODE` | нет, `public` | `public` \| `friend` (план Б, 22.2) |
| `PSN_TARGET_ONLINE_ID` | после миграции не обязательна | используется только `db:bootstrap-owner` |

### 22.9 Что остаётся на сессии 2–4

| Сессия | Подфаза | Объём |
|---|---|---|
| 2 | 20.2 | Миграция `0013`, `db:bootstrap-owner`, сессия `v:2` (+ совместимость `v:1`), `requireUser`, Google OAuth (22.4), лимиты, `/api/auth/me`, эндпоинты «Доступ» (22.5), страницы `/login` (кнопка Google) и «Доступ» (frontend), `multiuser_not_ready` |
| 3 | 20.3 | `0014`, проверка (шаг 5), слой `scope` и перевод всех API/`stats`/`recommend`/`roadmap`/`wrapped`/`export`, ESLint-запрет, тесты утечек, `0015` |
| 4 | 20.4 | Синк по пользователям (очередь поверх глобального «один `running`»), звенья cron, `PUT /api/me/psn` и проверка доступа к профилю (`psn_access_status`), онбординг, план Б при необходимости, лимиты LLM/RAWG/HLTB на пользователя + общий потолок, Telegram/бэкап владельцу по всем |
| QA | 20.5 | Изоляция, роли, миграция на копии прод-данных, e2e на двух пользователях |

Решено в 20.4: коды `PUT /api/me/psn`, способ проверки закрытого профиля и период повторной проверки `unavailable` — 22.13.

### 22.11 Уточнения реализации `0014` (20.3)

- `user_id integer not null default 1 references allowed_users(id) on delete cascade` в 19 таблицах (список в 22.1). Литерал `1` вместо подстановки id скриптом: `db:bootstrap-owner` гарантирует `owner.id = 1`. Первый блок миграции проверяет это: данные есть, а owner `id = 1` нет — `RAISE EXCEPTION` до любых изменений (пустая БД проходит).
- Внешние ключи добавлены обычными (без `NOT VALID` + `VALIDATE`): данные малы; идемпотентный вариант `docs/release-neon-0014.sql` проверяет `pg_constraint` по имени.
- Составные FK `(user_id, game_id) -> games(user_id, id)` стоят у `game_status`, `game_trophy_sets`, `playtime_snapshots`, `game_month_exclusions`, `roadmap_order`, `roadmap_excluded`, `recommend_dislikes`, `recommend_reasons`; `(user_id, trophy_set_id) -> trophy_sets(user_id, id)` у `game_trophy_sets` и `trophies`. Для них созданы `unique (user_id, id)` в `games` и `trophy_sets`.
- Чтобы слой `scope` мог между `0014` и `0015` писать `ON CONFLICT` по финальным ключам, рядом со старыми PK добавлены unique: `psn_profile(user_id)`, `roadmap_settings(user_id)`, `recommend_llm_usage(user_id, day)`, `recommend_discover_cache(user_id, day)`, `recommend_external_dislikes(user_id, external_source, external_id)`. У `psn_profile.id` и `roadmap_settings.id` добавлен `default 1`: код `scope` колонку `id` не передаёт (до `0015` она заполняется сама, после — удалена).
- Старые PK `game_trophy_sets (game_id, trophy_set_id)` и `game_month_exclusions (game_id, month)` не меняются (`game_id` глобален, составной PK избыточен).
- Контрольные значения до и после: `docs/release-neon-0014-check.sql` (счётчики, суммы часов и трофеев). Тест `src/db/release-sql-0014.test.ts`.
- Тесты, которые создают данные, должны сначала вставить owner (`createTestDb` делает это сам).

### 22.10 Уточнения реализации 20.2

- Ошибки `id_token` (подпись, `iss`, `aud`, `exp`, `nonce`) дают `oauth_failed`; неподтверждённый email, нет в списке, `blocked`, чужой `google_sub` дают `access_denied`.
- Callback резервирует попытку `kind='google'` как неуспех до обмена кода и снимает её (`success = true`) только после выдачи сессии. Старт `GET /api/auth/google` лимит только проверяет и ничего не пишет.
- Самоблокировка и самоудаление owner: `409 owner_protected`. Разблокировка тоже проверяет `MAX_USERS` (`409 user_limit`). Ответ `PATCH`: `200 { user }`.
- `gamesCount` и `lastSyncAt` считаются по `user_id` для каждого пользователя (20.3, см. 22.12).
- `POST /api/auth/login` отвечает `401 invalid_credentials`, если owner в `allowed_users` нет или он `blocked`; сессия выдаётся `v:2` (`uid` = id owner, `amr = pwd`).
- `/api/auth/me` и `/api/access/*` требуют сессию в `proxy.ts`, а `requireUser`/`requireOwner` (`src/server/auth/require-user.ts`) читают роль и статус из БД.

### 22.12 Отступления и решения реализации 20.3

- **Слой `scope` не вводится.** Вместо репозиториев в `src/server/scope/` каждая функция доступа к данным принимает `userId` вторым параметром (см. 22.6). Причина: объём (переписывание всех модулей и тестов под репозитории) при том же результате изоляции. Защита от пропусков: статический тест `user-scope.test.ts`, тесты утечек на двух пользователях, ESLint-запрет импорта `@/db` из UI и страниц.
- **Все `/api/*` под `requireUser`** (закрывает B-2), кроме `/api/auth/login`, `/api/auth/logout`, `/api/auth/google*` (вход) и `/api/cron/*` (`CRON_SECRET`). `/api/health` тоже требует сессию и показывает запуски синка только пользователя сессии. `src/proxy.ts` по-прежнему отсекает запросы без подписанной cookie, `requireUser` проверяет пользователя и роль по БД.
- **Глобальные таблицы не тронуты:** `psn_auth`, `login_attempts`, `notify_log`, `recommend_llm_state`, `allowed_users`. Ограничение «один `running` в `sync_runs`» остаётся глобальным: ручной синк пользователя B при идущем синке A получает `409 sync_in_progress`.
- **Синк в 20.3:** ручной `POST /api/sync` запускает синк пользователя сессии и читает его `allowed_users.psn_online_id`. У владельца без своего ника используется `PSN_TARGET_ONLINE_ID`; у остальных без ника — `500 config_error` (онбординг: 20.4). Продолжение звена (`/api/cron/sync?continue=<id>`) берёт пользователя из `sync_runs.user_id`. Ежедневный cron, watchdog и еженедельная копия работают для владельца (`getOwnerUserId`); Telegram-уведомления остаются владельцу.
- **`GET /api/wrapped`:** ник берётся из `allowed_users.psn_online_id` пользователя сессии, затем из его сохранённого профиля PSN. `PSN_TARGET_ONLINE_ID` в ответ больше не попадает.
- **Блокировки:** advisory-локи статусов, восстановления и порядка плана берутся на пользователя (`status_backups:<id>`, `backup_restore:<id>`, `roadmap_order:<id>`).
- **LLM-бюджет:** `recommend_llm_usage` ведётся на пользователя (ключ `(user_id, day)`), общий потолок `LLM_DAILY_LIMIT` по сумме пользователей добавлен в 20.4 (22.13). `recommend_llm_state` (пауза после неудач) остаётся общей.
- **Копия и восстановление:** `GET /api/backup`, `POST /api/backup/restore` и `status_backups` работают только с данными пользователя сессии; статусы из файла применяются только к его играм.
- **Ограничение до `0015` (снято миграцией `0015`, 22.14):** `psn_profile` и `roadmap_settings` пока имеют PK `id` со значением по умолчанию `1`, поэтому вторая строка (второго пользователя) не вставится, пока `0015` не заменит PK на `user_id`. Аналогично старые unique `games(title_id)`, `trophy_sets(np_communication_id)`, `trophies(trophy_set_id, trophy_id)`, `playtime_snapshots(game_id, snapshot_date)`, `planned_games(external_source, external_id)` мешают двум пользователям иметь одинаковые игры. Реальный второй пользователь возможен только после `0015`; тесты изоляции моделируют состояние после `0015`, удаляя эти ключи на PGlite.
- **Cookie `v:1` и `createSessionToken` удалены** (отдельный коммит после `0015`, закрывает N-3): `readSessionToken` читает только `v:2`, старая cookie `v:1` даёт `401`/редирект на `/login`. `e2e/session.ts` выдаёт `v:2` owner. Побочный эффект выкладки: единственная активная сессия, выданная до Фазы 20.2, перестаёт работать (вход заново).

### 22.13 Синк, доступ к PSN и лимиты по пользователям (Фаза 20.4)

Работает на схеме после `0014` и после `0015`; миграций 20.4 не требует (RAWG/HLTB-счётчики: см. «Открытое» ниже).

**Кто попадает в обход.** Пользователь «подходит для синка», если `status = 'active'`, `psn_access_status = 'ok'` и есть `psn_online_id`. Владелец без своего ника подходит всегда и читает `PSN_TARGET_ONLINE_ID` (22.12). Любой другой без ника или без `ok` в обход не попадает.

**Cron `GET /api/cron/sync` (Bearer `CRON_SECRET`).** Параметры: ничего (старт обхода), `continue=<runId>&hop=<N>` (звено, как раньше), `queue=<userId>` (следующий пользователь, `userId` = id только что закончившего пользователя, целое >= 0). Пользователь всегда берётся из БД, не из запроса.
- Старт обхода: сначала повторная проверка доступа для `unavailable` и `friend_required` (не больше 5 пользователей, не чаще раза в 6 ч на пользователя), затем запуск `daily` для первого подходящего по `id` (владелец, `id = 1`, идёт первым). Ответ как раньше: `202 { started: true, resumed, runId }`; `200 { started: false, reason: 'already_running' | 'not_resumable' | 'user_inactive' | 'queue_empty' }`.
- Следующий пользователь: когда `daily`-запуск закончился окончательно (success/failed, не «остановка по бюджету»), сервер самовызовом (`continueChain`-канал, тот же Bearer, origin из env) зовёт `?queue=<id закончившего пользователя>`. Берётся первый подходящий пользователь с `id` больше `userId` (по возрастанию `id`); фильтра «за сегодня» нет, обход всегда идёт строго вперёд по `id` и заканчивается ответом `queue_empty`. Следствие: повторный ручной вызов cron без параметров за один день запускает `daily` заново для всех подходящих пользователей (идемпотентность данных синка сохраняется, но лишние обращения к PSN возможны). Если запуск пользователя не удалось стартовать (исключение), берётся следующий. Сбой одного пользователя (ошибка PSN, `failed`) обход не останавливает: его запуск закрыт `failed`, дальше идёт следующий.
- У каждого пользователя свой `sync_runs` (kind `daily`); глобальный «один `running`» (22.12) сохраняется, поэтому пользователи идут строго друг за другом; каждый укладывается в звенья по `SYNC_TIME_BUDGET_MS` как раньше.
- `continue` проверяет пользователя запуска: `status <> 'active'` (blocked/invited) или нет подходящего ника -> `200 { started: false, reason: 'user_inactive' }`, запуск не возобновляется (данные не трогаются).
- Если самовызов недоступен (нет origin/secret), остальные пользователи синкаются кнопкой или завтрашним cron; риск зафиксирован в отчёте 20.4.

**Ручной синк `POST /api/sync` (пользователь сессии).** Новые ответы вместо `500 config_error` для пользователя без ника (N-2): `409 psn_not_set` («Укажите ник PSN, чтобы запустить синк.»), `409 psn_not_verified` (ник есть, `psn_access_status <> 'ok'`: «Доступ к профилю PSN не подтверждён. Проверьте ник и откройте профиль.»). `500 config_error` остаётся только для отсутствия серверных настроек PSN или owner.

**Состояние и ввод ника.**

| Метод и путь | Тело / ответ |
|---|---|
| `GET /api/me/psn` | 200 `{ onlineId, accessMode, accessStatus, checkedAt, canStartSync, onboardedAt, sync }`. `canStartSync = onlineId задан и accessStatus = 'ok'`. `sync` = последний не-`hltb` запуск пользователя `{ id, kind, status, phase, startedAt, finishedAt }` или `null` |
| `PUT /api/me/psn` | JSON + проверка `Origin`. Тело `{ onlineId?: string }`; без `onlineId` перепроверяется сохранённый (кнопка «Проверить снова»). Ник: trim, 3..16 символов, `^[A-Za-z][A-Za-z0-9_-]{2,15}$`. 200 `{ onlineId, accessMode, accessStatus: 'ok', checkedAt, canStartSync: true }` |

Проверка идёт только через `src/server/psn/` техническим NPSSO (`PSN_NEW_USER_MODE=public`): профиль по нику -> `accountId`, затем одна страница игр (`getUserPlayedGames`, limit 1) и одна страница трофейных сетов. Токены и NPSSO не логируются. Результат пишется в `allowed_users`: `psn_access_status`, `psn_access_checked_at`, `psn_online_id`, `psn_account_id`.

| Статус HTTP / `error.code` | Когда | `psn_access_status` |
|---|---|---|
| 200 | профиль, игры, трофеи читаются | `ok` |
| 400 `invalid_request` | не JSON, не тот Origin, `onlineId` не строка / не подходит под шаблон / нет ни тела, ни сохранённого ника | не меняется |
| 409 `psn_id_taken` | этот ник (без учёта регистра) уже у другого пользователя, либо совпадает с `PSN_TARGET_ONLINE_ID` (ник владельца), а запрашивает не owner | не меняется |
| 409 `psn_account_locked` | у пользователя уже есть игры, а ник указывает на другой аккаунт PSN (накладывать чужие игры на коллекцию нельзя; переименование того же аккаунта разрешено) | не меняется |
| 422 `psn_not_found` | профиля с таким ником нет | `not_found` |
| 422 `psn_private` | профиль найден, но игры/трофеи закрыты | `private` (при `psn_access_mode = 'friend'`: `friend_required`, код ответа `psn_friend_required`) |
| 429 `rate_limited` + `Retry-After` | предыдущая проверка этого пользователя была меньше 30 с назад | не меняется |
| 503 `psn_unavailable` | PSN вернул ошибку/лимит, токен технического аккаунта не принят | `unavailable` (если у пользователя уже был рабочий `ok` с другим ником, статус и ник не затираются) |
| 500 `config_error` | нет серверных настроек PSN | не меняется |

Ник записывается при любом результате проверки (кроме 400/409/429/500), кроме случая, когда сменой ника перезаписывался бы рабочий `ok`-ник неудачной проверкой: тогда сохранённое состояние не меняется. Повторная проверка `unavailable`: автоматически при каждом старте cron-обхода, но не чаще чем раз в 6 ч на пользователя; вручную: PUT (с паузой 30 с). `private` и `not_found` автоматически не перепроверяются (нужно действие пользователя). После успешной проверки пользователь запускает первый синк обычным `POST /api/sync`. `onboarded_at` ставится при первом завершённом `success` запуске пользователя (синк ручной или cron), а также дозаполняется в `GET /api/me/psn`, если у пользователя есть `success`-запуск (не `hltb`), но `onboarded_at` пуст (сбой UPDATE, запуск до 20.4): иначе guard вернул бы member на онбординг.

**Лимиты LLM.** `recommend_llm_usage` остаётся на пользователя `(user_id, day)`. Три уровня: потолок по виду вызова на пользователя (`phrases` 8; виды `discover_*` удалены 2026-10-31); `LLM_USER_DAILY_LIMIT` (по умолчанию 12, 1..200) — всего вызовов в сутки на пользователя; `LLM_DAILY_LIMIT` — общий потолок: сумма `calls` по всем пользователям за сутки МСК (раньше был потолок на единственного пользователя; при нескольких пользователях задавайте не меньше `число_пользователей × 12`; по умолчанию 60 = 5 пользователей. Если значение меньше `подходящих пользователей × LLM_USER_DAILY_LIMIT`, старт cron-обхода пишет предупреждение в лог (`llmLimitWarning`, без секретов); поведение лимита не меняется). Занятие вызова атомарное (транзакция с advisory lock): один запрос проверяет вид, пользователя и сумму. `recommend_llm_state` (пауза после неудач) общая.

**Telegram и копия (всё владельцу, по всем пользователям).**
- Watchdog `sync_missed`: проверка по каждому подходящему пользователю; дедуп в `notify_log` по `kind` (`sync_missed` у owner, `sync_missed:<user_id>` у остальных), текст дополняется «Пользователь: <ник PSN>». Для не-owner (есть подпись) тексты `sync_missed` и `sync_stale` вместо «Проверьте cron и NPSSO» говорят: вероятно, профиль закрыт или нет дружбы с техаккаунтом; cron и NPSSO проверять, если синк не идёт и у остальных. `GET /api/cron/watchdog` ответ: `sync` (результат owner, как раньше), `users: [{ userId, isOverdue, ageHours, alert }]`, `backup`. Без owner в БД: `500 config_error`, в Telegram уходит «owner не найден» (раз в сутки, `kind = 'owner_missing'`).
- После неудачного звена: `sync_stale` считается по пользователю запуска (`sync_stale:<id>` у не-owner); `auth_expired`, `npsso_invalid`, `token_age` глобальные (технический NPSSO один).
- Еженедельная копия: по файлу на каждого активного пользователя, владельцу в тот же чат; `kind = backup_weekly` у owner, `backup_weekly:<id>` у остальных; подпись содержит ник PSN.

**Открытое (закрыто разделом 24, `0017_provider_usage`).** Лимиты RAWG и HLTB по пользователям: счётчикам нужна таблица, миграцию 20.4 не создаёт. Сейчас: HLTB ограничен структурой (пачка `HLTB_BATCH` на синк пользователя, пересмотр раз в 30 дней, ручной запуск под единственным слотом `running`); RAWG вне ночного шага вызывается только запросами пользователя (поиск/«скоро выходят») и подтверждением «Нового от ИИ» (оно уже за LLM-лимитом). Предложение для `0016`: `provider_usage(user_id, day, provider, calls)`.

### 22.14 Реализация `0015_user_id_contract` (20.3)

Миграция `src/db/migrations/0015_user_id_contract.sql`, для прода `docs/release-neon-0015.sql` (идемпотентный, пишет в журнал drizzle, в конце флаги `true`), контрольные значения `docs/release-neon-0015-check.sql`, откат `docs/release-neon-0015-rollback.sql`. Тесты: `src/db/release-sql-0015.test.ts`, `src/server/post-0015-sync.test.ts`; состояние «ровно после 0014» проверяет `src/server/post-0014-compat.test.ts` (`createTestDb({ migrations: 15 })`).

Что меняется (данные строк не меняются, не удаляются):
- **PK `user_id`** у `psn_profile` и `roadmap_settings`; колонки `id` удалены вместе со singleton CHECK (`-- DATA LOSS`: значение всегда 1; в SQL-миграции это `DROP COLUMN`).
- **Составные PK:** `recommend_llm_usage (user_id, day)`, `recommend_discover_cache (user_id, day)`, `recommend_external_dislikes (user_id, external_source, external_id)`, `recommend_reasons (user_id, game_id, signals_hash)`.
- **Удалены глобальные unique:** `games_title_id_key`, `trophy_sets_np_communication_id_key`, `trophies_set_trophy_key`, `playtime_snapshots_game_date_key`, `planned_games_external_key`; дубли PK как unique (`psn_profile_user_key`, `roadmap_settings_user_key`, `recommend_llm_usage_user_day_key`, `recommend_discover_cache_user_day_key`, `recommend_external_dislikes_user_key`).
- **Удалены индексы без `user_id`, замененные префиксными из 0014:** `game_status_status_idx`, `games_concept_id_idx`, `games_last_played_at_idx`, `planned_games_status_idx`, `playtime_snapshots_date_idx`, `roadmap_order_position_idx`, `sync_runs_started_at_idx`, `trophies_earned_at_idx`. `sync_runs_one_running_idx` (глобальный «один running») остаётся.
- **`user_id` без `DEFAULT 1`** во всех 19 таблицах (NOT NULL остаётся с 0014): INSERT без `user_id` падает, молча приписать строку owner нельзя.
- Не меняются: `game_trophy_sets (game_id, trophy_set_id)`, `game_month_exclusions (game_id, month)`, PK `game_id` у `game_status`, `roadmap_order`, `roadmap_excluded`, `recommend_dislikes` (22.11, `game_id` глобален); глобальные таблицы (22.12).

**Решение B-1 (`recommend_reasons`).** PK = `(user_id, game_id, signals_hash)` как в 22.1, `ON CONFLICT` в `src/server/recommend/db.ts` целится в `(user_id, game_id, signals_hash)`. Причина: при PK `(game_id, signals_hash)` upsert с чужим `user_id` превратился бы в UPDATE чужой строки без ошибки (составной FK не срабатывает, `user_id` в конфликтной строке не меняется); с `user_id` в ключе такой запрос становится вставкой и падает на составном FK. Окно выкладки: скрипт `0015` -> деплой кода. Между ними прод-код 20.3 пишет кэш фраз с target по старому PK и получает ошибку, которую шаг LLM синка превращает в предупреждение (фразы не кэшируются, данные и остальной синк не страдают). Если код выкатили раньше миграции: то же самое в обратную сторону.

**Проверка всех `ON CONFLICT`:** цели совпадают с ключами после 0015 (`games (user_id, title_id)`, `playtime_snapshots (user_id, game_id, snapshot_date)`, `trophy_sets (user_id, np_communication_id)`, `trophies (user_id, trophy_set_id, trophy_id)`, `psn_profile (user_id)`, `roadmap_settings (user_id)`, `recommend_llm_usage`/`recommend_discover_cache (user_id, day)`, `recommend_external_dislikes (user_id, source, id)`, `recommend_reasons (user_id, game_id, signals_hash)`; по PK `game_id`: `game_status`, `roadmap_order`, `recommend_dislikes`; глобальные: `notify_log.kind`, `psn_auth.id`, `recommend_llm_state.id`; остальные `onConflictDoNothing` без target).

**Совместимость кода и схемы.** Код 20.3 (прод на момент написания) пишет `user_id` явно везде и работает на схемах после 0014 и после 0015 (кроме кэша фраз, см. выше). Код 20.3 до слоя `userId` (до PR #19) на схеме после 0015 не работает.

**Откат.** Откат кода без обратной SQL после 0015 невозможен: старый код вставляет в `psn_profile`/`roadmap_settings` колонку `id` и не передаёт `user_id` (default снят). `docs/release-neon-0015-rollback.sql` возвращает схему 0014 (колонки `id` со значением 1, старые PK/unique/индексы, `DEFAULT 1`) и убирает запись 0015 из журнала без потери данных, но только пока данные принадлежат одному пользователю (`user_id = 1`); при данных второго пользователя скрипт останавливается до изменений, остаётся восстановление из ветки Neon `before-0015` или PITR. После отката нужно выкатить предыдущую версию кода (до коммита 0015); новый код на схеме 0014 только не кэширует фразы «Подскажи».

**Порядок выкладки:** копия разметки (16.3) -> ветка Neon `before-0015` -> `release-neon-0015-check.sql` («до») -> `release-neon-0015.sql` -> `release-neon-0015-check.sql` («после») -> деплой кода -> сутки наблюдения -> `MULTIUSER_ENABLED=1` только после QA изоляции (22.7, шаг 8).


## 24. Счётчики RAWG и HLTB по пользователям (хвост 20.5, B-4)

### 24.1 Схема (миграция `0017_provider_usage`, expand)

Новая таблица `provider_usage`, существующие таблицы и данные не меняются.

| Колонка | Тип | Примечание |
|---|---|---|
| `user_id` | integer NOT NULL | FK `allowed_users(id)` ON DELETE CASCADE |
| `day` | date NOT NULL | сутки МСК (`mskDateString`) |
| `provider` | text NOT NULL | `rawg` или `hltb` (CHECK `provider_usage_provider_check`) |
| `calls` | integer NOT NULL DEFAULT 0 | CHECK `calls >= 0`; число реальных исходящих запросов к провайдеру |

PK `(user_id, day, provider)`. Новых данных миграция не создаёт (таблица пустая); `provider_usage` входит в список user-scoped таблиц (запрос без `user_id` = баг).

### 24.2 Правило (как у LLM, 22.13)

Модуль `src/server/usage/provider-usage.ts`, `reserveProviderCall(db, userId, provider, now, limits)`. Вызов занимается ДО исходящего запроса, атомарно, в транзакции под advisory-локом (отдельный ключ): сумма `calls` по всем пользователям за сутки и провайдеру < общего потолка и `calls` пользователя < пользовательского лимита. Результат: `ok | user_limit | total_limit`. Возврат при неудаче не делается (запрос к провайдеру ушёл и расходует его квоту).

Что считается запросом:
- RAWG: каждый реальный HTTP-запрос в `requestJson` (поиск, «скоро выходят» мимо кэша процесса). Попадание в кэш не считается.
- HLTB: каждый поисковый запрос `client.search` в шаге синка и массовом запуске.

Что делает превышение:
- RAWG (запрос пользователя): `503 catalog_unavailable` с `details.reason = 'rate_limited'` (тот же код, что при 429 RAWG: экран показывает «лимит запросов исчерпан», ручной ввод остаётся; новых значений reason нет).
- HLTB (синк, массовый запуск): шаг останавливается как при исчерпании времени (`stop: 'limit'`), игры остаются непроверенными, предупреждение `hltb_limit` в `sync_runs.warnings`; запуск не падает.

Fail-open: если БД недоступна или таблицы ещё нет (код выкатили раньше `0017`), счётчик не блокирует провайдера. Резерв считается в памяти процесса (по провайдеру, пользователю и суткам) и всё равно применяет те же лимиты внутри процесса; ошибка не пробрасывается и не логирует секреты. Строго до деплоя `0017` применять не обязательно, но до применения лимиты работают только в пределах одного процесса.

### 24.3 Переменные окружения

| Переменная | По умолчанию | Диапазон | Смысл |
|---|---|---|---|
| `RAWG_USER_DAILY_LIMIT` | 60 | 1..1000 | запросов RAWG на пользователя в сутки |
| `RAWG_DAILY_LIMIT` | 300 | 0..5000 | общий потолок RAWG в сутки (сумма пользователей); 0 = каталог выключен |
| `HLTB_USER_DAILY_LIMIT` | 300 | 1..2000 | запросов HLTB на пользователя в сутки |
| `HLTB_DAILY_LIMIT` | 1000 | 0..10000 | общий потолок HLTB в сутки; 0 = HLTB выключен |

Бесплатный RAWG даёт 20 000 запросов в месяц (около 650 в сутки); умолчание оставляет запас. Нечисловое значение = умолчание.

## 23. Тур по сайту (Фаза 21)

Прогресс интерактивного тура хранится в профиле пользователя (`allowed_users`), чтобы тур не запускался заново в другом браузере. Текст и шаги тура контрактом не описываются (зона frontend/designer).

### 23.1 Версия тура

`TOUR_VERSION` (целое, сейчас `1`) живёт в `src/shared/tour.ts` и нужна и серверу, и UI. Меняется вручную, когда тур существенно обновили и его нужно показать всем ещё раз.

### 23.2 Схема (миграция `0016_tour_progress`, expand)

Две nullable-колонки в `allowed_users`, без default, без CHECK. Drizzle-миграция `0016` данные не трогает; отметку существующих пользователей делает только `release-neon-0016.sql` (23.3):

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `tour_version` | integer | да | наибольшая версия тура, которую пользователь прошёл или пропустил. `null` = тур не пройден (равносильно 0) |
| `tour_completed_at` | timestamptz | да | когда `tour_version` записан в последний раз (UTC) |

Прод: `docs/release-neon-0016.sql` (идемпотентный, пишет в журнал drizzle), `docs/release-neon-0016-check.sql`; тест `src/db/release-sql-0016.test.ts`. Совместимость: старый код колонок не знает и работает на новой схеме; новый код на старой схеме падает на запросе тура (503 `db_unavailable`), остальные эндпоинты не затронуты (выбор `select()` в `getUserById` перечислит новые колонки, поэтому миграцию применять ДО деплоя кода).

### 23.3 Эндпоинты

Оба требуют сессию (`requireUser`), `userId` берётся только из сессии, в запросе его нет. Ответы `Cache-Control: no-store`.

**`GET /api/me/tour`** -> 200
`{ "ok": true, "data": { "version": 1, "completedVersion": 0 | 1 | ..., "shouldAutoStart": true | false } }`
- `version` = текущий `TOUR_VERSION`.
- `completedVersion` = `tour_version ?? 0`.
- `shouldAutoStart = onboarded_at IS NOT NULL AND completedVersion < version`. Роль не учитывается: owner без онбординга автозапуска не получает. Решение продакта: существующим пользователям тур не навязываем, он доступен только вручную (меню «Как пользоваться»); поэтому `release-neon-0016.sql` один раз (в запуске, добавляющем колонку) ставит всем существующим строкам `tour_version = 1`, `tour_completed_at = now()`. Автозапуск получают только пользователи, созданные после выкладки и прошедшие онбординг (или когда `TOUR_VERSION` повысят). Ручной запуск тура из UI от `shouldAutoStart` не зависит.

**`PUT /api/me/tour`** тело `{ "done": true, "version": <целое> }` -> 200, тот же формат данных, что у GET (уже с новым `completedVersion` и `shouldAutoStart`).
- Запись: `tour_version = greatest(coalesce(tour_version, 0), version)`, `tour_completed_at = now()` только если значение выросло. Идемпотентно: повтор с той же или меньшей версией ничего не меняет и тоже отвечает 200. Версию вниз не откатить.
- «Прошёл» и «пропустил» не различаются: оба = `done: true`.
- Только `application/json`, проверка Origin как у `PUT /api/me/psn`.

### 23.4 Ошибки

| Код | Когда |
|---|---|
| 401 `unauthorized` | нет или невалидная сессия |
| 400 `invalid_request` | не JSON, не `application/json`, чужой Origin, `done` не `true`, `version` не целое число от 1 до `TOUR_VERSION` включительно (версия из будущего отклоняется) |
| 503 `db_unavailable` | БД недоступна |

Данные других пользователей недоступны по построению: UPDATE и SELECT идут по `allowed_users.id = userId сессии`. Тур не влияет на синк, статусы и остальные данные.

## 25. Дубли игр (Фаза 23)

Цель: одна игра = одна карточка везде. Версии одной игры (PS4 и PS5, переиздания) склеиваются: остаётся «главная», остальные («дубли») прячутся из всех списков, их часы суммируются в главную.

### 25.1 Схема (миграция `0018_game_duplicates`, expand)

Две колонки в `games`. Данные не удаляются, существующие строки получают `duplicate_of_game_id = NULL`, `not_duplicate = false`; сами дубли синк расставит при следующем запуске.

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `duplicate_of_game_id` | integer | да | не NULL = эта игра дубль главной игры с таким id. FK `(user_id, duplicate_of_game_id)` -> `games(user_id, id)` (главная того же пользователя, чужую указать нельзя), `ON DELETE NO ACTION`. CHECK: не равно собственному `id` (`games_duplicate_self_check`). Пишет только синк (25.2) и `POST .../not-duplicate` (25.5). Главная всегда имеет `duplicate_of_game_id = NULL` (цепочек нет) |
| `not_duplicate` | boolean NOT NULL DEFAULT false | нет | ручной флаг «это не дубль». `true` = игра исключена из склейки навсегда, синк флаг не меняет и не перезаписывает |

Индекс `games_user_duplicate_of_idx (user_id, duplicate_of_game_id) WHERE duplicate_of_game_id IS NOT NULL`. Прод: `docs/release-neon-0018.sql` (идемпотентный, пишет в журнал drizzle), тест `src/db/release-sql-0018.test.ts`. Совместимость: старый код колонок не знает и на новой схеме работает (дубли для него просто не помечены); новый код на старой схеме падает, поэтому миграцию применять ДО деплоя.

### 25.2 Правило склейки (синк)

Шаг синка после игр и трофеев, на пользователя `ctx.userId`, идемпотентный (повтор даёт тот же результат). Сбой шага = предупреждение `duplicates_failed` в `sync_runs.warnings`, синк не падает, прежние пометки остаются.
- Участвуют игры пользователя, у которых `hidden_at IS NULL` и `not_duplicate = false`. Скрытые и «не дубль» всегда самостоятельны (`duplicate_of_game_id = NULL`).
- Ключ группы: `concept_id`; если его нет, нормализованное имя (нижний регистр, без ™®©, без текста в скобках, без слов `ps4`/`ps5`/`playstation 4`/`playstation 5`, без знаков препинания, пробелы схлопнуты). Игра без `concept_id` присоединяется к группе по `concept_id`, если нормализованное имя совпадает с именем её участника; иначе группируются между собой по имени.
- Главная: больше `play_duration_seconds`; при равенстве остаётся текущая главная (ровно та, на которую уже ссылаются дубли), затем `ps5_native_game`, затем меньший `id`. Остальные группы из 2+ игр получают `duplicate_of_game_id = id главной`. Группа из одной игры: `NULL`.
- Статус: если у новой главной нет `game_status`, а у кого-то из группы есть, берётся статус с наибольшим `status_changed_at` (копия строки). Статусы дублей не удаляются.
- Синк не трогает `not_duplicate` и `hidden_at`.

### 25.3 Что считается и где дубли прячутся

Дубль = `games.duplicate_of_game_id IS NOT NULL`. Видимая игра = `hidden_at IS NULL AND duplicate_of_game_id IS NULL` (`gameVisible` и `visibleGames`).
| Место | Правило |
|---|---|
| `GET /api/games`, сводка (`/api/collection/summary`: totals, playing, services, continue, counts, years, forgottenCount), фильтры и счётчики | дубли исключены; `totals.games` считает карточки |
| Бэклог, План (`/api/roadmap`), Подскажи (`/api/recommend`), «Ближе к платине», Итоги (Wrapped), Статистика, активность, шаг HLTB | дубли исключены как отдельные игры (нет второй карточки, второго «пройдено», второго места в топе, второго жанра) |
| Часы | `playSeconds`/`hours` главной = её часы + часы всех её дублей; сортировка по часам и `totals.playSeconds` тоже. В статистике, Итогах, Плане и активности снимки дублей (`playtime_snapshots`) сливаются в ряд главной (на каждую дату сумма последних известных значений версий, до первого снимка версии берётся её первое значение), поэтому сумма часов за любой период не меняется. Если главная скрыта, часы её дублей тоже не считаются |
| Трофеи | карточка и окно главной показывают объединение трофейных сетов всей группы; сет, привязанный к нескольким версиям, считается один раз (`trophySetCounted` считает сет по `hidden_at` его игр, дубль не делает сет невидимым; сет, привязанный только к дублям, засчитывается за главной). Трофеи периода (`earned_at`) по сетам, поэтому суммы не меняются |
| Окно игры дубля (`GET /api/games/{id}` по id дубля) | работает (отдаёт саму игру, `duplicateOfGameId` указывает на главную), в списках её нет |

### 25.4 Поле `linkedVersions` у `GameItem`

`GameItem.linkedVersions: { gameId: number, title: string, platform: 'PS4' | 'PS5' | 'PC', hours: number }[]`. Есть только у главной игры и только если у неё есть дубли; иначе `[]`. Сервер присылает всегда; в типе необязательное (фикстуры src/ui). `hours` версии = её собственные часы (округление как у `GameItem.hours`), не сумма. Порядок: по часам убыванию, затем по `gameId`. Сумма `hours` версий + собственные часы главной = `GameItem.hours` главной (с точностью округления). Заодно в `GameItem` добавляется `duplicateOfGameId: number | null` (у главной и обычных `null`; не `null` только в ответах по id дубля).

Поле присутствует во всех ответах, где отдаётся `GameItem` (список, сводка, детали, ответы мутаций, карточки статистики и Итогов).

### 25.5 `POST /api/games/{id}/not-duplicate`

Сессия, CSRF и проверка Origin как у других мутаций (`PUT .../hidden`), `userId` из сессии. Тело необязательно: `{ "versionId": <целое> }` (JSON, `application/json`).
- `{id}` главная, тела нет: все её дубли отвязываются.
- `{id}` главная, `versionId`: отвязывается только эта версия (должна быть дублем `{id}`, иначе `404 not_found`).
- `{id}` сама дубль: отвязывается эта игра (`versionId` не нужен и игнорируется).
Для каждой отвязанной игры: `duplicate_of_game_id = NULL`, `not_duplicate = true` (синк её больше не склеивает). Идемпотентен: у уже отвязанной повтор тоже 200.
- 200: `{"ok":true,"data":{"game":{ GameItem игры {id} уже без отвязанных версий }}}`.
- 400 `invalid_request`: id не число, тело не JSON-объект или `versionId` не целое. 404 `not_found`: нет игры, чужая игра (то же тело, что у несуществующей), `versionId` не её дубль. 503 `db_unavailable`.
Отменить это действие в API нельзя (синк не вернёт склейку). Риск склейки разных игр с общим `concept_id` лечится этой кнопкой.

## 26. Статистика и Итоги «за всё время», «Когда ты играешь» (Фазы 25–26)

Миграций нет: схема БД не меняется. Все изменения только добавляют поля; ответы `year` и `month` (10.1, 11.1) не меняются ни в одном существующем поле. Типы: `src/server/stats/types.ts`, `src/server/wrapped/types.ts` (во frontend только `import type`). Новые поля в типах необязательные (фикстуры `src/ui`), сервер присылает их всегда там, где указано.

### 26.1 `GET /api/stats?period=all` (Фаза 25)

`period` принимает `year | month | all`. При `period=all` параметры `year` и `month` **игнорируются** (в том числе мусорные: `period=all&year=abc` это `200`). Остальной мусор по-прежнему `400 invalid_request` (неизвестный `period`, плохой `withService`).

**`period` в ответе.** `{ "type": "all", "year": <текущий год МСК>, "month": null, "from": "2019-03-02" | null, "to": "2026-10-27" | null, "fromUtc": ... | null, "toUtc": ... | null }`. `year` для `all` это текущий год по Москве (поле остаётся числом, чтобы не ломать типы), смысла не несёт. `from` / `to`: первая и последняя даты данных пользователя по МСК. Источники: `playtime_snapshots.snapshot_date`, `trophies.earned_at` (только засчитанные), `game_status.completed_at` / `dropped_at`, `games.first_played_at` / `last_played_at` (видимые игры). Данных нет совсем: `from`, `to`, `fromUtc`, `toUtc` равны `null`. Иначе `fromUtc` = полночь МСК `from`, `toUtc` = полночь МСК следующего за `to` дня (`toUtc` исключается). Тип `StatsPeriod` теперь объединение: у `type: "all"` четыре поля границ могут быть `null`.

**Какие блоки как заполняются при `all`.** Форма ответа та же, что у `year` (UI не проверяет на undefined), плюс новые поля:

```json
{ "ok": true, "data": {
  "period": { "type": "all", "year": 2026, "month": null, "from": "2019-03-02", "to": "2026-10-27",
              "fromUtc": "2019-03-01T21:00:00.000Z", "toUtc": "2026-10-27T21:00:00.000Z" },
  "years": [2026, 2025, 2024],
  "header": { "completed": 41, "dropped": 9, "hours": 2840.5, "platinum": 33 },
  "hours": {
    "byMonth": [null, null, null, null, null, null, null, null, null, null, null, null],
    "estimatedByMonth": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "estimatedHours": 410.3, "hasEstimate": true,
    "firstSnapshotDate": "2026-03-04", "periodPartial": true,
    "byYear": [
      { "year": 2024, "hours": 900.1, "estimatedHours": 900.1, "measuredHours": 0 },
      { "year": 2025, "hours": 1200.0, "estimatedHours": 300.0, "measuredHours": 900.0 },
      { "year": 2026, "hours": 700.4, "estimatedHours": 0, "measuredHours": 700.4 }
    ],
    "unattributed": 40.0
  },
  "genres": { "hasData": true, "items": [ { "key": "ACTION", "label": "Экшен", "value": 52.5, "gameIds": [17] } ], "games": { "17": { "id": 17, "title": "...", "coverUrl": null } } },
  "top": { "byHours": [ { "game": { "...": "GameItem" }, "hours": 310.2, "estimated": false } ], "byTrophies": [ { "game": { "...": "GameItem" }, "points": 1200, "counts": { "platinum": 1, "gold": 3, "silver": 9, "bronze": 20, "total": 33 } } ] },
  "rareTrophies": { "period": [ "= allTime" ], "allTime": [ "RareTrophy по 14.1" ] },
  "trophies": {
    "counts": { "platinum": 33, "gold": 120, "silver": 300, "bronze": 800, "total": 1253 },
    "byMonth": [ { "month": 1, "platinum": 0, "gold": 0, "silver": 0, "bronze": 0, "total": 0 } ],
    "byYear": [ { "year": 2024, "platinum": 10, "gold": 40, "silver": 100, "bronze": 300, "total": 450 } ]
  },
  "finished": { "groups": [], "byYear": [ { "year": 2024, "completed": 12, "dropped": 3 } ] },
  "played": { "games": {}, "groups": [] },
  "playPattern": { "byHour": [0, 0, "... 24 числа"], "byWeekday": [0, 0, 0, 0, 0, 0, 0], "total": 1253, "peakHour": 22, "peakWeekday": 5, "label": "по времени трофеев", "hasData": true }
} }
```

| Поле | Правило при `all` |
|---|---|
| `years` | как в 10.1 (годы с данными по убыванию, текущий год всегда) |
| `header.hours` | **сумма PSN `playDuration` по видимым играм**: `games.play_duration_seconds` каждой видимой игры (не скрыта, не дубль) плюс `play_duration_seconds` всех её дублей (Фаза 23, 25.3; то же выражение, что `GameItem.playSeconds`: дубль в суммы входит ровно один раз, через главную). Округление до 0.1. `null`, если у пользователя нет видимых игр |
| `header.completed` / `dropped` | число видимых игр со `status = completed` / `dropped` и непустой датой (`completed_at` / `dropped_at`), без ограничения периодом |
| `header.platinum` | число платин с `earned_at`, равно `trophies.counts.platinum` |
| `hours.byYear` | по возрастанию года, **без пропусков**: от самого раннего года из `years` до текущего года МСК (в том числе годы с нулями). `hours` = `measuredHours + estimatedHours` (в десятых долях, без накопления погрешности). `measuredHours`: реальные часы года по снимкам (формула 1.6 для периода «год»: `S_end - S_base`, отрицательная дельта = 0, дубли слиты в главную как в 25.3). `estimatedHours`: оценочная часть года (оценка 1.6 по месяцам года, с учётом исключённых месяцев 15.1, оценка дубля относится к главной). UI рисует `estimatedHours` штриховкой «оценка» |
| `hours.unattributed` | часы, которые нельзя отнести к годам: `header.hours - sum(byYear[].hours)`, в десятых долях. Это игры без снимков, игры с часами до первого снимка и без `first_played_at` (оценки нет), ручное расхождение `games.play_duration_seconds` и последнего снимка, скачки PSN вниз. Может быть и **отрицательным** (PSN уменьшил время, а в годах уже учтён прирост; у игры, чья оценка шла по одному исключённому месяцу, наоборот плюс). Обычно близок к `0` |
| **Инвариант** | `sum(hours.byYear[].hours) + hours.unattributed == header.hours` (с точностью до 0.1 float; считается в целых десятых). Если `header.hours = null`: `byYear` по нулям (или `[]`), `unattributed = 0` |
| `hours.estimatedHours` / `hasEstimate` | сумма `byYear[].estimatedHours` / `> 0` |
| `hours.byMonth` | 12 `null` (при `all` не используется) , `estimatedByMonth` 12 нулей |
| `hours.firstSnapshotDate` | как в 10.1. `periodPartial = true`, если `firstSnapshotDate = null`, либо есть оценочные часы (`estimatedHours > 0`), либо `unattributed != 0` (UI показывает плашку «часть часов оценка / не по снимкам») |
| `trophies.counts` | все засчитанные трофеи с `earned = true` и `earned_at` (без периода), как в 10.1 по фильтрам видимости и сетов-сирот |
| `trophies.byYear` | по возрастанию года, без пропусков (диапазон как у `hours.byYear`, года по МСК). Платина по годам = `byYear[].platinum`. `sum(byYear[].X) == counts.X` |
| `trophies.byMonth` | 12 нулевых элементов (форма сохраняется) |
| `finished.byYear` | `[{year, completed, dropped}]`, диапазон лет как у `hours.byYear`; год по МСК по `completed_at` / `dropped_at`, те же правила, что `header.completed/dropped`. `sum(completed) == header.completed`. `finished.groups` при `all` всегда `[]` |
| `genres` | топ-8, веса 1/N (1.9, 10.1). Игры: видимые игры с часами `> 0` (PSN, как `header.hours`) **или** со статусом `completed` / `dropped` когда-либо. `gameIds` по часам игры по убыванию |
| `top.byHours` | топ-10 видимых игр по **суммарным** часам PSN (с дублями, `effectiveSeconds`), порядок `top.ts`: часы по убыванию, `lower(title)`, `id`. `estimated` всегда `false` (это суммарные часы PSN, не оценка) |
| `top.byTrophies` | по очкам всех полученных трофеев (13.2 без периода) |
| `rareTrophies` | `period` = `allTime` (одна выборка, 14.1, включая трофеи без даты) |
| `played` | `{ games: {}, groups: [] }` (блок «Игры месяца» только для года/месяца) |

**Что не меняется.** `period=year` и `period=month`: ни одно существующее поле не изменено. Новые поля для них: только `playPattern` (26.3). `hours.byYear`, `hours.unattributed`, `trophies.byYear`, `finished.byYear` присутствуют **только** при `period.type = "all"`.

**Скорость.** Число запросов к БД не зависит от числа игр и снимков: снимки не грузятся целиком, берутся строки «первый снимок игры» и «последний снимок игры в каждом году» (из них та же формула 1.6 даёт часы по годам), трофеи агрегируются в SQL. Покрыто `perf.test.ts`.

**Изоляция.** Все запросы с `user_id` из сессии (как в остальной статистике, 22.6); тест на утечки между двумя пользователями.

### 26.2 `GET /api/wrapped?year=all` (Фаза 26)

Выбрано `year=all` (а не `period=all`): параметр один, и он уже выбирает «что показывать». `year`: целое 2000..2100 **или** строка `all`; остальное `400 invalid_request` (`year=ALL`, `year=all2`, пустая строка = нет параметра = текущий год).

Новые поля ответа (всегда присутствуют, форма `empty` сохраняется):
| Поле | Значение |
|---|---|
| `scope` | `"year"` или `"all"` |
| `allTimeAvailable` | `true`, если у пользователя есть данные для набора «всё время». При `scope = "all"` точно (`mode = story`); при `scope = "year"` приближённо: хоть у одного года из `years` `hasData = true` (11.1). Для карточки «Всё время» в выборе года, присутствует в обоих ответах |
| `allTime` | `null` при `scope = "year"`; при `all` объект (ниже) |
| `playPattern` | блок 26.3 для года или всего времени |
| `year` | при `all` текущий год МСК (число, как `period.year` в 26.1), смысла не несёт |
| `period` | при `all`: `{from, to, fromUtc, toUtc}` как в 26.1 (поля могут быть `null`) |

`allTime` при `scope = "all"`:
```json
{
  "firstGame": { "hasData": true, "at": "2016-05-09T17:00:00.000Z", "source": "first_played", "game": { "...": "GameItem" } },
  "hoursByYear": { "hasData": true, "total": 2840.5, "unattributed": 40.0, "byYear": [ { "year": 2025, "hours": 1200.0, "estimatedHours": 300.0, "measuredHours": 900.0 } ] },
  "platinumByYear": { "hasData": true, "total": 33, "items": [ { "year": 2024, "count": 10 } ] },
  "busiestYear": { "hasData": true, "year": 2025, "hours": 1200.0, "estimated": true },
  "topGenre": { "hasData": true, "key": "ACTION", "label": "Экшен", "value": 52.5 }
}
```
| Поле | Правило |
|---|---|
| `firstGame` | видимая игра с самой ранней датой первого запуска: `min(games.first_played_at)` главной и её дублей (`source: "first_played"`, `at` = эта дата). Если ни у одной игры даты нет: игра самого раннего полученного трофея по `earned_at` (`source: "first_trophy"`, `at` = `earned_at`; игра сета = минимальный id видимой игры, сет-сирота игры не даёт). Нет ни того ни другого: `hasData: false`, `at: null`, `source: null`, `game: null`. Игры без `first_played_at` в первую очередь не участвуют (PSN не отдал дату). Честное ограничение: `first_played_at` это то, что PSN помнит о первом запуске, у старых игр оно может быть позже реального |
| `hoursByYear` | то же, что `hours.byYear` / `unattributed` / `header.hours` из 26.1 (одна функция расчёта), `hasData = total > 0` |
| `platinumByYear` | платины по `earned_at` по годам МСК, диапазон лет как у `hoursByYear`, `total` = сумма, `hasData = total > 0` |
| `busiestYear` | год с максимальным `hours` в `hoursByYear.byYear` (ничья: более ранний), `hours` его часы, `estimated = estimatedHours > 0` в этом году. `hasData = false`, `year = null`, `hours = 0`, если часов нет |
| `topGenre` | первый жанр из `genres.items` (топ-1 за все годы); `hasData = false` и `key`/`label` `null`, `value` `0`, если жанров нет |

Остальные блоки при `all` (форма как в 11.1, но за все годы):
- `hours`: `total` = `header.hours` из 26.1, `days = round(total/24, 1)`, `byMonth` 12 `null`, `estimatedByMonth` 12 нулей, `estimatedHours`/`hasEstimate` как в 26.1, `topMonth = null`, `hasData = total > 0`.
- `topGames`: топ-5 по суммарным часам PSN (как `top.byHours`, `estimated: false`, `rank`, `seconds` суммарные).
- `longestGame`: игра №1 из `topGames` (самая долгая за всё время), `playCount = game.playCount`; пусто = `hasData: false`, `game: null`.
- `genres`: топ-3 (правила 26.1).
- `trophies`: `counts` все; `platinum.first/last/rarest` по всем платинам; `rare` = `rareTrophies.allTime` (топ-5).
- `finished`: `completed.count` / `dropped.count` как `header` из 26.1, `items: []` (списки слайдами «за всё время» не показываются), `busiestMonth: null`, `hasData = count сумма > 0`.
- `mode`: `empty`, если одновременно нет часов, трофеев и завершённых/брошенных (`emptyState.syncStartedOn` как в 11.1).
- `slides` при `all` (порядок фиксирован): `start`, `firstGame` (если `allTime.firstGame.hasData`), `hours` (если `hours.hasData`), `platinumYears` (если `platinumByYear.hasData`), `busiestYear` (если `busiestYear.hasData`), `genres` (если `genres.hasData`), `longestGame` (если `longestGame.hasData`), `playPattern` (если `playPattern.hasData`), `final`. `topGames`, `finished`, `trophies` в наборе «всё время» не показываются. `empty`: `["empty"]`.
- `slides` при `year`: порядок 11.1; **новое**: `playPattern` ставится сразу после `trophies` (если `playPattern.hasData`; при `hasData = false` слайда нет, поэтому у существующих годов без паттерна `slides` не меняется). Новые идентификаторы в `WrappedSlideId`: `firstGame`, `platinumYears`, `busiestYear`, `playPattern`.

`withService` (17.2/20.8) влияет только на `rare` (как в годовом наборе). Эндпоинт для года не меняется. `years` в ответе остаётся списком лет; кнопка «Всё время» зависит от `allTimeAvailable`.

### 26.3 «Когда ты играешь»: `playPattern` (Фаза 26)

Распределение **полученных трофеев** по времени суток и дню недели по **Europe/Moscow** (UTC+3 без перехода на летнее время, как везде). Это не игровое время: PSN отдаёт время только трофеев, поэтому подпись `label: "по времени трофеев"`.

```json
{ "byHour": [3, 0, 0, "... всего 24 числа, индекс = час МСК 0..23"],
  "byWeekday": [20, 15, 10, 8, 30, 55, 40],
  "total": 178, "peakHour": 22, "peakWeekday": 5,
  "label": "по времени трофеев", "hasData": true }
```
| Поле | Правило |
|---|---|
| `byHour` | ровно 24 числа, индекс = час `0..23` по МСК. Трофей в 23:59:59 МСК идёт в 23, в 00:00:00 МСК уже в 0 следующего дня (событие 21:00:00Z это 00:00 МСК следующих суток) |
| `byWeekday` | ровно 7 чисел, индекс 0 = понедельник .. 6 = воскресенье (ISO). День недели считается по дате МСК (не UTC): 21:30Z субботы это воскресенье 00:30 МСК |
| `total` | число трофеев в периоде: `sum(byHour) == sum(byWeekday) == total == trophies.counts.total` того же периода (те же фильтры: `earned`, есть `earned_at`, видимость сетов) |
| `peakHour` / `peakWeekday` | индекс максимума (ничья: меньший индекс); `null`, если `total = 0`. В примере выше `peakWeekday: 5` = суббота (0 = понедельник, 6 = воскресенье) |
| `label` | константа `"по времени трофеев"` |
| `hasData` | `total >= 20` (порог `PLAY_PATTERN_MIN_TOTAL`); иначе `false`: UI скрывает блок/слайд (мало данных, паттерн был бы шумом). Массивы всё равно присылаются |

Где присутствует: `GET /api/stats` для `period` `year` / `month` / `all` (по периоду ответа; при `month` это только трофеи месяца) и `GET /api/wrapped` (для года и для `all`). Пустой период: нули, `total: 0`, пики `null`, `hasData: false`.

### 26.4 Решения и риски

- Часы «за всё время» берутся из текущего `games.play_duration_seconds`, а не из последнего снимка: сумма совпадает с числом на карточках коллекции. Разницу со снимками честно показывает `unattributed`.
- Годы часов до первого синка это только оценка 1.6 (месячная, по `first_played_at`..`last_played_at`); штриховка «оценка» в UI обязательна.
- Паттерн времени по трофеям смещён в сторону игр с трофеями и в сторону моментов, когда трофеи синхронизировались с PS (PSN хранит время получения, но старые трофеи могут быть выданы пачкой при синхронизации консоли).

## 26. История игры в окне игры (Фаза 34)

Цель: на «Обзоре» окна игры показать, как шла игра: мини-график часов по неделям и отметки трофеев/платины на той же шкале. Только добавление поля в `GET /api/games/{id}` (12.5); существующие поля не меняются, миграций нет, схема БД не меняется, новых секретов нет. Расчёт в чистой функции `src/server/collection/history.ts` (Vitest), выборка в `details.ts`.

### 26.1 Поле `history`

`GameDetailsResponse.history: GameHistory | null`. Сервер присылает всегда; в типе необязательное (фикстуры src/ui, старые ответы).

```json
"history": {
  "weeks": [
    { "weekStart": "2026-05-04", "seconds": 7200, "estimatedSeconds": 5400, "trophies": 0, "platinum": false },
    { "weekStart": "2026-05-11", "seconds": 0, "estimatedSeconds": 0, "trophies": 2, "platinum": true }
  ],
  "truncated": false,
  "hasHours": true,
  "hasEstimate": true,
  "playedDays": 14,
  "firstSnapshotDate": "2026-09-01"
}
```

| Поле | Правило |
|---|---|
| `history` | `null`, если у игры (с её дублями) нет ни одного снимка и ни одного трофея с `earnedAt`. Иначе объект |
| `weeks` | непрерывный ряд недель по возрастанию `weekStart`, **от первой недели с данными до последней недели с данными** (недели без данных внутри ряда присутствуют с нулями; пустые недели до и после ряда не добавляются). `[]`, если данных по неделям нет (например снимки есть, но играть не начинали, оценки нет, трофеев нет) |
| `weekStart` | понедельник недели, дата МСК `YYYY-MM-DD`. Неделя = пн..вс **по МСК**. Событие 01:00 МСК понедельника (22:00 UTC воскресенья) относится к новой неделе |
| `seconds` | всё время недели, секунды: реальные + оценочные |
| `estimatedSeconds` | оценочная часть `seconds` (до первого снимка, 1.6), `0 <= estimatedSeconds <= seconds`. UI рисует её штриховкой и подписывает «оценка». Реальная часть = `seconds - estimatedSeconds` |
| `trophies` | число полученных трофеев недели (все типы, по `earnedAt` в МСК). Трофеи без `earnedAt` не попадают |
| `platinum` | `true`, если платина получена в эту неделю (`trophies >= 1` тогда обязательно) |
| `truncated` | `true`, если ряд длиннее 52 недель и отдана только **последняя** 52-недельная часть (трофеи и часы более ранних недель в ответ не входят) |
| `hasHours` | у игры есть хотя бы один снимок. `false` = часов по неделям нет вообще (только отметки трофеев): UI не рисует столбцы часов |
| `hasEstimate` | в `weeks` есть хотя бы одна неделя с `estimatedSeconds > 0` |
| `playedDays` | число дней МСК с положительным приростом времени по снимкам (суточные дельты, как 14.3: первый снимок дельты не даёт, отрицательная дельта = 0). `null`, если снимков нет. Нижняя оценка: дни до первого синка неизвестны, пропущенные синком дни дают одну дату на всю дельту. Относится ко всей истории, а не к усечённым 52 неделям |
| `firstSnapshotDate` | дата МСК первого снимка игры (с дублями: самого раннего), `null`, если снимков нет. UI показывает границу «дальше только оценка» |

Строка «Играл 14 дней, последний раз 6 июн.» собирается на клиенте: `playedDays` и `GameItem.lastPlayedAt` (`lastPlayedAt` уже есть в ответе).

### 26.2 Как считаются недели

1. **Реальные часы.** Снимки игры (для главной: слитые снимки группы, `mergeDuplicateSnapshots`, 25.3) превращаются в суточные дельты (`dailyActivity`, 14.3); дельта дня относится к неделе этого дня (МСК). Часы дублей суммируются в главную, поэтому окно главной показывает группу целиком; окно самого дубля (ответ по id дубля) считает историю только по самому дублю, как и остальные поля этого ответа (трофеи 12.5).
2. **Оценка до первого снимка (1.6).** Для каждой версии игры месячные доли оценки (`estimateByMonth`, с исключёнными месяцами 15.1) раскладываются по дням **внутри окна оценки**: от даты `first_played_at` (МСК) до `min(L0, D0)` включительно (L0, D0 по 1.6), только дни месяца этой доли; доля делится поровну по дням, остаток целиком в последний день. Затем дни складываются по неделям. Так сумма `estimatedSeconds` по всем неделям равна оценке 1.6 игры (и сумма оценки + реальных дельт = последнему значению времени по снимкам, с точностью до обнулённых отрицательных дельт). Оценка относится только к дням до первого снимка, реальные часы после `D0` оценкой не затрагиваются. Неделя, в которой стыкуются оценка и первые реальные дельты, смешанная (`0 < estimatedSeconds < seconds`).
3. **Трофеи.** Из уже загруженного `trophyList` (12.5): полученные трофеи с `earnedAt`, по неделе МСК; платина = `type: "platinum"`. Для главной это объединение трофеев группы (25.3), сет, общий для версий, считается один раз.
4. **Окно.** От минимальной до максимальной недели, где есть реальные часы, оценка или трофеи. Если ряд длиннее 52 недель, отдаются последние 52 недели (`truncated: true`).

### 26.3 Изоляция, дубли, стоимость

- Все выборки с `user_id` сессии (снимки `playtime_snapshots.user_id`, `games.user_id`, `game_month_exclusions.user_id`). Чужой id игры = `404 not_found` как в 12.5, история чужой игры недоступна.
- Скрытая игра отдаётся и с историей (как и прогноз платины в 14.2).
- Добавляются **два** запроса, не зависящих от числа игр: (а) снимки группы (игра и её дубли) вместе с `first_played_at` и `last_played_at` версий; (б) исключённые месяцы открытой игры (по её `id`; исключения хранятся на главной игре, на дубле UI их не ставит, поэтому месяцы дублей в расчёт не входят). Трофеи берутся из уже загруженного списка. Всего у `GET /api/games/{id}` становится 5 запросов в одном `Promise.all`.

### 26.4 UI (напоминание для frontend, детали в design-system «Фаза 34»)

Блок «Длительность прохождения» (16, `DurationEditor`) на «Обзоре» сворачивается до одной строки (раскрывается по клику). Пометка «оценка» ставится у штриховых столбцов и в легенде, если `hasEstimate`; если `hasHours: false`, столбцы часов не рисуются.

## Фаза 30. «У тебя нет»: предложения игр вне библиотеки

Решение Артёма 2026-10-31 убрало «Новое от ИИ» (раздел 19: Groq придумывал названия, RAWG их проверял). Фаза 30 возвращает режим «вне библиотеки» по другой модели: **кандидатов выбирает каталог RAWG и правила, а не LLM**. LLM только формулирует причину (одна фраза на карточку), при выключенном LLM или сбое причина шаблонная. Название, жанры, обложка, рейтинг и платформы берутся только из RAWG, выдумать игру модель не может. Раздел 19 остаётся удалённым, его роуты и тексты не возвращаются; здесь новая схема ответа.

### 30.1 Схема: миграций нет
Переиспользуются таблицы 13b, схема Drizzle и БД не меняются.
- `recommend_discover_cache (user_id, day)`: `day` сутки МСК, `profile_hash` = первые 32 hex sha256 от списка фасетов (30.3), `payload` jsonb, `refreshes` не используется (всегда 0), `created_at`. Один ряд на пользователя и сутки.
- `recommend_external_dislikes (user_id, external_source = 'rawg', external_id, title, cover_url, created_at)`: «Не интересно», срок `DISLIKE_TTL_DAYS` (30 суток), повтор продлевает.
- `provider_usage (user_id, day, 'rawg')`: счётчик запросов RAWG (раздел 24).
- `recommend_llm_usage.discover_auto_calls`: счётчик вида `discover` (потолок 1 вызов в сутки на пользователя; общий `calls`, `LLM_USER_DAILY_LIMIT` и `LLM_DAILY_LIMIT` действуют как раньше). Колонка раньше не использовалась (значения 13b в ней нет, всегда 0).
- Все выборки и записи с `user_id` (запрос без него = баг).

Форма `payload` (внутреннее, клиенту не отдаётся как есть): `{ version: 1, complete: boolean, fetched: string[], pool: PoolEntry[], candidates: StoredCandidate[] }`. `fetched` = уже опрошенные фасеты суток (`genres:action`, `tags:horror`, `all`), `pool` = отобранные записи RAWG (до 120), `candidates` = ранжированные, до 24 штук, с причиной. `complete = false`, пока не опрошены все фасеты (лимит RAWG, нехватка времени звена, сбой): следующий синк в те же сутки добирает только недостающее.

### 30.2 `GET /api/recommend/discover`
Сессия. Только чтение: ни RAWG, ни LLM не вызываются, ответ быстрый. Подборку создаёт ночной синк (30.4). Параметров нет (лишние игнорируются).

`200 { ok: true, data: DiscoverResponse }`:
```
DiscoverResponse = { items: DiscoverItem[]; meta: DiscoverMeta }
DiscoverItem = {
  externalSource: 'rawg'; externalId: string; title: string;
  releaseDate: string | null;            // YYYY-MM-DD, уже вышла
  coverUrl: string | null;               // https, из RAWG
  platforms: ('PS5' | 'PS4')[];          // только PlayStation
  genres: GenreKey[];                    // жанры RAWG, сведённые к GenreKey (shared/genres); может быть []
  rating: number | null;                 // пользовательский рейтинг RAWG 0..5, один знак
  metacritic: number | null;             // 1..100
  rawgUrl: string | null;                // https://rawg.io/games/<slug> (ссылка-атрибуция на карточке)
  reason: { text: string; source: 'llm' | 'template' };
  planned: boolean; plannedId: number | null;   // есть отменённая запись Плана (planned/done в выдачу не попадают)
}
DiscoverMeta = {
  catalog: 'ok' | 'unavailable';         // unavailable: нет RAWG_API_KEY или RAWG_DAILY_LIMIT = 0
  generatedAt: string | null;            // ISO, когда собрана подборка
  stale: boolean;                        // подборка не за сегодняшние сутки МСК
  partial: boolean;                      // не все фасеты опрошены (лимит RAWG, время, сбой)
  reason: 'not_generated' | 'no_candidates' | null;
  total: number;                         // кандидатов в подборке до фильтра выдачи
  limit: number;                         // 12
}
```
- Выдача: из `candidates` последней подборки (за сегодня, иначе за любые прошлые сутки, `stale = true`) убираются игры библиотеки, активные записи Плана и «Не интересно», остаётся до 12 по убыванию `score`. Фильтр действует в момент чтения: добавленная в библиотеку/План и скрытая игра исчезают сразу, не дожидаясь пересчёта.
- Пустая выдача: нет подборки = `items: []`, `reason: 'not_generated'` (синк ещё не считал); подборка есть, всё отфильтровано = `reason: 'no_candidates'`; `catalog: 'unavailable'` = `items: []`, `reason: null`, подборка не читается.
- Ошибки: `401`, `503 db_unavailable` (БД). Сбои RAWG и LLM ошибкой HTTP не бывают (это синк, не запрос).

### 30.3 Кандидаты и ранжирование (`src/server/recommend/discover.ts`, чистая часть `discover-rank.ts`)
- Профиль вкуса: история пользователя (`loadHistory`: видимые completed/playing/dropped, дубли склеены по Фазе 23) -> `genreStats` и `affinityOf` как в «Подскажи». Фасеты запроса = до 3 жанров с наибольшим affinity > 0, не «наказанные» (`penalized`), у которых есть соответствие в RAWG, плюс общий фасет `all` (топ без жанра) всегда последним. Соответствие жанров: ACTION `genres=action`, ADVENTURE `adventure`, ROLE_PLAYING_GAMES `role-playing-games-rpg`, SHOOTER `shooter`, RACING `racing`, SIMULATION `simulation`, FIGHTING `fighting`, ARCADE `arcade`, CASUAL `casual`, STRATEGY `strategy`, PUZZLE `puzzle`, FAMILY `family`, HORROR `tags=horror` (жанра в RAWG нет); MUSIC_RHYTHM, PARTY, OTHER без фасета. Пустая история = только `all`.
- Запрос RAWG на страницу: `platforms=187,18` (PS5, PS4), фасет, `metacritic=75,100` (порог `RAWG_DISCOVER_MIN_METACRITIC`), `ordering=-metacritic`, `exclude_additions=true`, `page_size=40`. Запись принимается, если вышла (`released` не позже сегодняшнего МСК), есть PS5 или PS4 и `metacritic >= 75`.
- Исключения кандидатов (при сборке и повторно при чтении): любая игра библиотеки пользователя, в том числе скрытая и дубль Фазы 23; активная запись Плана (`planned`/`done`, по `externalId` и названию); неистёкшее «Не интересно». Совпадение с библиотекой: равенство ключей после нормализации (`normalizeTitle`; `normalizeGameName` без скобок и меток PS4/PS5; отбрасывание слов издания `edition`, `complete`, `definitive`, `deluxe`, `ultimate`, `goty`, `remastered`...) или `titleMatches` (сходство ≥ 0.9 при одинаковых номерах частей) с `games.name` или `games.hltb_name`.
- Страниц на фасет: 1; если после исключений осталось меньше 6, и RAWG говорит `next`, добираются 2-я и 3-я. Не больше 8 запросов RAWG за запуск шага.
- `score = 0.6 * affinity + 0.4 * quality`, где `affinity` = максимум affinity по жанрам кандидата (жанров с соответствием нет = 0), `quality = (metacritic - 75) / 25` в [0, 1]. Кандидат, все известные жанры которого «наказаны», отбрасывается. Тай-брейк: `metacritic` убыв., `externalId` возр. В `candidates` попадает до 24 лучших, дубли по `externalId` и ключу названия схлопываются.
- Причина-шаблон: «Похожа на «A» и «B», жанр «Z».» (A, B = до двух игр истории пользователя, пересекающихся по жанру с кандидатом, по часам убыв.; Z = жанр с наибольшим affinity среди жанров кандидата). Одна похожая: «Похожа на «A», жанр «Z».». Нет похожих, есть жанр: «Жанр «Z» тебе заходит, Metacritic N.». Ничего: «Высоко оценена на PlayStation: Metacritic N.».

### 30.4 Шаг синка «У тебя нет» (`src/server/sync/discover-step.ts`)
- Идёт после шага LLM в конце успешного звена, не фаза курсора. Ошибка шага = предупреждение `discover_step_failed`, итог запуска не меняется. Выполняется на пользователя запуска (`ctx.userId`).
- Нет `RAWG_API_KEY` или `RAWG_DAILY_LIMIT = 0`: шаг молча пропускается. Подборка за сегодня `complete = true`: пропуск (раз в сутки). Иначе опрашиваются недостающие фасеты по одной странице на запрос; перед каждым запросом проверяется `ctx.timeLeft() >= 10 с` (иначе остановка, `partial`) и занимается слот `provider_usage` (24.2). Исчерпание лимита = остановка шага, предупреждение `discover_limit`; сбой фасета (сеть, 5xx, мусор) = фасет остаётся недобранным, предупреждение `discover_failed` с причиной (`timeout`, `network`, `http_error`, `rate_limited`, `bad_response`), остальные фасеты продолжаются.
- После опроса пул ранжируется, подборка пишется в `recommend_discover_cache` на сегодня (если есть хоть один кандидат; иначе прежняя подборка не затирается). Данные прежних суток не удаляются.
- Причины: когда подборка `complete`, LLM включён (раздел 20, `LLM_PROVIDER` + `LLM_API_KEY`), не на паузе и свободен слот вида `discover` (1 вызов в сутки): один вызов на все (до 24) карточки. Модель получает только факты RAWG и названия до двух игр библиотеки на карточку; отвечает `{"reasons":[{"id":<число>,"text":"..."}]}`. Принимается фраза строкой до 140 символов без ссылок и без названий других кандидатов; остальные остаются шаблонными. Сбой, таймаут, мусор: вызов возвращается в бюджет, учитывается в `fail_streak` (пауза 20.4), все причины шаблонные (`source: 'template'`), повтор LLM для этой подборки в те же сутки не делается. LLM никогда не выбирает и не меняет состав игр.
- Лимиты RAWG: каждый реальный HTTP-запрос считается в `provider_usage` (`RAWG_USER_DAILY_LIMIT`, `RAWG_DAILY_LIMIT`), см. 24.2. Штатный расход: до 8 запросов на пользователя в сутки.

### 30.5 «Не интересно» для внешней игры
- `POST /api/recommend/discover/dislike`, тело `{ "externalSource": "rawg", "externalId": "3328", "title": "...", "coverUrl": "https://..." | null }` (все поля обязательны, лишние = 400). Идемпотентно, повтор продлевает срок. Сессия, `Content-Type: application/json`, проверка Origin. `200 { ok, data: { externalId } }`. Ошибки: `400 invalid_request`, `503 db_unavailable`. `externalId` 1..64 без пробелов и `/ ? # % \`, `title` 1..200, `coverUrl` https до 2048 или `null`.
- `DELETE /api/recommend/discover/dislike/{externalId}`: снимает отметку, идемпотентно, проверка Origin. `200 { ok, data: { externalId } }`.
- Отметка скрывает игру в `GET /api/recommend/discover` сразу, на 30 суток; следующий пересчёт её тоже не вернёт.

### 30.6 «В План»
Отдельного роута нет: экран вызывает существующий `POST /api/roadmap/planned` (17.7) с `{ title, releaseDate, coverUrl, externalSource: 'rawg', externalId, wantAtRelease: false }`. `409 planned_duplicate` экран считает успехом (игра уже в Плане). Игра с активной записью Плана перестаёт попадать в выдачу.

### 30.7 Изоляция, секреты, проверки
- `user_id` во всех запросах шага и роутов (охранный тест `user-scope`); подборка, дизлайки и счётчики одного пользователя не видны другому.
- `RAWG_API_KEY` и `LLM_API_KEY` только из env, не попадают в ответы, кэш, предупреждения и логи; URL с ключом в ошибки не пишется (`CatalogError` содержит только причину).
- Новых переменных окружения нет. RAWG free tier 20 000/мес.: штатный расход шага до 8 запросов на пользователя в сутки, под потолками `RAWG_USER_DAILY_LIMIT` (60) и `RAWG_DAILY_LIMIT` (300).
- Тесты: `src/server/recommend/discover*.test.ts`, `src/server/sync/discover-step.test.ts`, `src/app/api/recommend/discover/*.test.ts`. Обязательные: ни одной игры библиотеки (в том числе скрытой, дубля и с другим написанием) в выдаче; работа при выключенном и падающем LLM; лимиты RAWG и LLM-вида; изоляция двух пользователей.

## 27. NPSSO с сайта и журнал токена PSN (Фаза 24)

Цель: owner обновляет NPSSO за минуту на сайте, без Vercel и передеплоя; по журналу видно реальный срок жизни NPSSO и refresh-токена. `PSN_NPSSO` из env остаётся запасным (порядок в 1.8 не меняется: живой access -> refresh -> NPSSO из env). Токен PSN общий (технический аккаунт, `psn_auth` singleton), поэтому журнал глобальный, как `psn_auth`, а не по пользователям (исключение из правила `user_id`, как у `login_attempts`).

### 27.1 `POST /api/sync/npsso`

Только owner (`requireOwner`, роль берётся из БД). Порядок проверок: сессия (401) -> роль (403, member) -> Origin (`originAllowed`, как у `POST /api/sync`) и `Content-Type: application/json` (400 `invalid_request`) -> настройки (`TOKEN_ENCRYPTION_KEY`, `PSN_TARGET_ONLINE_ID`; нет = 500 `config_error`) -> формат (400) -> лимит (429) -> обмен с PSN. CSRF: тот же механизм, что у остальных мутаций (cookie `SameSite=Lax` + проверка Origin + обязательный `application/json`); отдельного токена в проекте нет.

Запрос: `{ "npsso": "<64 символа>" }`. Принимается также содержимое, которое выдаёт `https://ca.account.sony.com/api/v1/ssocookie` (`{"npsso":"..."}`), присланное как строка в поле `npsso`: сервер вытащит значение сам. Пробелы и кавычки по краям обрезаются. Формат: `^[A-Za-z0-9]{64}$`. Ошибка формата не обращается к PSN и не расходует лимит.

Ответ 200 (NPSSO принят PSN, токены зашифрованы и сохранены в `psn_auth`, `source = 'npsso'`):
```json
{ "ok": true, "data": { "accepted": true, "refreshExpiresAt": "2026-11-11T10:00:00.000Z", "token": { "issuedAt": "2026-11-01T10:00:00.000Z", "ageSeconds": 0, "lastEvent": { "event": "pasted", "at": "2026-11-01T10:00:00.000Z" } } } }
```
`refreshExpiresAt` = ориентир от `refresh_token_expires_in` PSN или `null`. Поле `token` устроено как `psnToken` в 27.4. NPSSO, токены и их части в ответ не попадают никогда.

Ошибки (конверт 4.1, сообщения фиксированные, текст PSN и исключений в ответ не попадает):
| Код | HTTP | Когда |
|---|---|---|
| `unauthorized` | 401 | нет сессии |
| `forbidden` | 403 | роль не owner |
| `invalid_request` | 400 | не JSON, нет `application/json`, чужой Origin, нет поля, не строка, неверный формат (`details.field = "npsso"`) |
| `rate_limited` | 429 | лимит попыток (27.2); `Retry-After` и `details.retryAfterSeconds` |
| `npsso_invalid` | 422 | PSN отвергло NPSSO (протух, чужой, не тот cookie). Токены в `psn_auth` не меняются |
| `psn_unavailable` | 503 | временный сбой или лимит на стороне PSN (429/5xx/сеть). Токены не меняются, пробовать позже |
| `config_error` | 500 | нет `TOKEN_ENCRYPTION_KEY` или `PSN_TARGET_ONLINE_ID` |
| `db_unavailable` | 503 | БД недоступна |
`npsso_invalid` добавляется в `ErrorCode` (`src/server/http.ts`). Ошибка PSN никогда не стирает прежние токены и данные: запись в `psn_auth` только после успешного обмена, одним upsert.

### 27.2 Лимит попыток

`login_attempts` с новым `kind = 'npsso'`; счётчики `password`, `google` и `npsso` независимы. Правило как в 3.3 (резерв неудачи до обмена, `success = true` при успехе, заблокированный запрос ничего не пишет, advisory lock): **3 неудачи с IP за 15 минут, 10 за час глобально**. Неудачей считаются отказ PSN и временный сбой PSN. Миграция `0019` расширяет `login_attempts_kind_check` до `('password','google','npsso')` (drop + add, данные не меняются).

### 27.3 Журнал `psn_token_events` (миграция `0019_psn_token_events`, expand)

| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `id` | integer identity PK | нет | |
| `user_id` | integer | да | кто вставил NPSSO (только для `pasted`), FK `allowed_users(id)` `ON DELETE SET NULL`; для событий синка `NULL` |
| `event` | text | нет | CHECK `pasted | refreshed | expired | from_env` |
| `details` | jsonb | да | без секретов (только числа, `source`, `reason`) |
| `created_at` | timestamptz | нет | default `now()` |

Индекс `psn_token_events_created_idx (created_at desc, id desc)`. Хранятся 200 последних событий (лишние удаляются при записи). События:
- `pasted`: NPSSO вставлен на сайте и принят. `details`: `{ "refreshTokenExpiresInSec": 864000 }`.
- `from_env`: обмен NPSSO из `PSN_NPSSO` прошёл в `getAccessToken` (токены обновились из env). Те же details.
- `refreshed`: refresh-токен обменян на новую пару. Пишется не чаще раза в 20 часов (иначе шум от каждого часового access). `details`: `{ "refreshTokenExpiresInSec": N }` (видно, продлевает ли refresh срок).
- `expired`: `getAccessToken` исчерпал refresh и NPSSO (бросил `auth_expired`, либо `npsso_invalid`, когда NPSSO из env отвергнут; если токенов нет и env пуст, это не протухание, события нет). Временные сбои PSN событий не пишут. Подряд идущие `expired` не дублируются (пока последнее событие `expired`, новое не пишется). `details`: `{ "reason": "auth_expired" | "npsso_invalid", "hadRefresh": bool }`.
Запись события не бросает и не мешает синку (сбой записи глотается; нет таблицы = события не пишутся). Срок жизни NPSSO = интервал от последнего `pasted`/`from_env` до `expired`; срок refresh-цепочки = от `pasted`/`from_env` до `expired`, между ними `refreshed`.

### 27.4 Дополнение `GET /api/sync/status` (8.4)

Новое поле `psnToken` (всем ролям, секретов нет; `null`, если событий ещё нет или таблицы нет):
```json
"psnToken": {
  "issuedAt": "2026-10-22T10:00:00.000Z",
  "ageSeconds": 864000,
  "source": "pasted",
  "lastEvent": { "event": "expired", "at": "2026-11-01T10:00:00.000Z", "details": { "reason": "auth_expired" } }
}
```
- `issuedAt` = время последнего `pasted` или `from_env` (последний обмен NPSSO; с него живёт refresh-цепочка), `ageSeconds` = `now - issuedAt`, `source` = `pasted | from_env`. Нет таких событий: `issuedAt`/`ageSeconds`/`source` = `null`.
- `lastEvent` = последнее событие любого вида (`event`, `at`, `details`) или `null`.
- Правка `psnAuth`: если последний завершённый запуск упал по `auth_expired`/`npsso_invalid`, но после его окончания было успешное `pasted` или `from_env`, `psnAuth = 'ok'` (баннер протухания исчезает сразу после вставки; следующий синк подтвердит). Иначе правило из 8.4.
Для UI: баннер протухания ведёт к полю «Вставить NPSSO» (owner); member видит баннер без поля (вставлять может только owner).

### 27.5 Секреты и проверки
- NPSSO существует только в теле запроса и локальной переменной на время обмена; не пишется в БД, `sync_runs`, `details`, ответы, `console.*`. Ошибки PSN проходят через `safeErr` с NPSSO и code в списке секретов, а в ответ идёт только фиксированный текст.
- Тесты: `src/app/api/sync/npsso/route.test.ts` (роль, CSRF, лимит, формат, нет NPSSO в ответах и логах, в т.ч. при ошибке PSN), `src/server/psn/token-events.test.ts` (журнал), `src/db/release-sql-0019.test.ts`. Прод: `docs/release-neon-0019.sql` + `docs/release-neon-0019-check.sql`. Миграцию применять ДО деплоя: журнал и статус без таблицы работают мягко (события не пишутся, `psnToken = null`), но лимит `kind = 'npsso'` на старой CHECK падает, и вставка NPSSO ответит `503`.

## 28. Подсказки смены статуса (Фаза 27)

Цель: статусы не устаревают молча. Решение Артёма: сайт только ПРЕДЛАГАЕТ, статус меняет пользователь кнопкой (существующий `PUT /api/games/{id}/status` или `POST /api/games/status-bulk`). Автосмены нет, синк подсказки не пишет и статусы не трогает. Подсказки считаются на лету при запросе (не хранятся), хранятся только отказы.

### 28.1 Схема (миграция `0020_status_hint_dismissals`, expand)

Таблица `status_hint_dismissals`: «не предлагать для этой игры по этому правилу». Данные других таблиц не меняются.
| Колонка | Тип | Null | Описание |
|---|---|---|---|
| `user_id` | integer | нет | владелец, FK -> `allowed_users(id)` ON DELETE CASCADE |
| `game_id` | integer | нет | игра пользователя; составной FK `(user_id, game_id)` -> `games(user_id, id)` ON DELETE CASCADE (чужую игру указать нельзя) |
| `rule` | text | нет | одно из `started`, `stale`, `platinum`, `returned` (CHECK `status_hint_dismissals_rule_check`) |
| `created_at` | timestamptz | нет | default `now()` |

PK `(user_id, game_id, rule)`: уникальность по тройке, повторный отказ идемпотентен (`ON CONFLICT DO NOTHING`). Прод: `docs/release-neon-0020.sql` (идемпотентный, пишет в журнал drizzle), `docs/release-neon-0020-check.sql`, тест `src/db/release-sql-0020.test.ts`. Миграцию применять ДО деплоя: новый код на старой схеме отвечает на подсказки `503 db_unavailable`, остальной сайт не затронут.

### 28.2 Правила (чистая часть: `src/server/sync/status-hints.ts`, константы и типы: `src/shared/status-hints.ts`)

Правило оценивается для каждой видимой игры (не скрыта, не дубль, статус не `service`). Одна игра = максимум одна подсказка: из подходящих правил, не отклонённых пользователем, берётся первое по приоритету `platinum` > `returned` > `started` > `stale`.

| `rule` | Вопрос | Условие | Предлагаемые статусы (`suggested`) |
|---|---|---|---|
| `started` | «Играю?» | статус `backlog` или нет статуса, `playSeconds > 0`, `lastPlayedAt` позже `statusChangedAt` (без статуса: любой запуск) и не старше `RECENT_LAUNCH_DAYS = 14` суток | `playing` |
| `stale` | «Отложить / бросить?» | статус `playing`, `max(lastPlayedAt, statusChangedAt)` старше `STALE_PLAYING_DAYS = 30` суток | `shelved`, `dropped` |
| `platinum` | «Пройдено?» | платина получена (28.3), статус не `completed` (нет статуса тоже считается), и статус не выставлен пользователем ПОСЛЕ получения платины (перепрохождение: `statusChangedAt > platinumEarnedAt` скрывает подсказку; если дата платины неизвестна, подсказка показывается) | `completed` |
| `returned` | «Вернулся?» | статус `dropped`, `lastPlayedAt` позже `max(statusChangedAt, droppedAt)` и не старше 14 суток | `playing` |

Сравнения строгие (`>` и `<`), границы дат включают сутки как есть, без округления до календарных дней. `now` передаётся параметром (тесты детерминированы).
- Перепрохождение: у `completed` подсказок `started`/`returned`/`platinum` нет (статус уже «пройдено», новый запуск не повод его менять). У `playing`, поставленного после платины, подсказки `platinum` нет (см. выше).
- Дубли (Фаза 23): игра = главная карточка. `lastPlayedAt` = максимум по группе (главная и её не скрытые дубли), `playSeconds` = сумма группы, платина = любая версия группы (28.3). Подсказка всегда про главную (`gameId` главной), статус берётся из строки главной.
- Отказ по дублю: отказ хранится по `game_id` как записан, но при чтении сопоставляется с главной группы (`coalesce(duplicate_of_game_id, id)`), поэтому после смены главной отказ не теряется.

### 28.3 Что считается «платина получена»

Платина считается по трофейным сетам группы (главная и её дубли). Для каждой версии-игры «основной сет» = привязанный к ней сет с наибольшим числом определённых трофеев (`defined_*` в сумме), ничья: меньший `id` сета. Платина получена, если в основном сете хотя бы одной версии `earned_platinum > 0`. Следствия:
- PS4 + PS5 (две версии, два сета, у каждого своя платина): достаточно платины в любой версии.
- DLC-платина: отдельный сет-дополнение, привязанный к той же игре, с собственной платиной не считается (основной сет другой, база без платины = «пройдено?» не предлагаем).
- Дата `platinumEarnedAt` = самая ранняя `earned_at` полученной платины основного сета (нет данных = `null`).
Ограничение: PSN не отдаёт связь «сет-дополнение к игре», выбор основного сета по размеру эвристика; ошибку лечит кнопка «Не предлагать».

### 28.4 `GET /api/status-hints`

Сессия (`requireUser`), `userId` из сессии, все выборки с `user_id`. Без параметров.
200:
```json
{
  "ok": true,
  "data": {
    "count": 2,
    "items": [
      {
        "gameId": 17,
        "rule": "platinum",
        "question": "Пройдено?",
        "reason": "Платина получена 12.10.2026, статус «Играю».",
        "suggested": ["completed"],
        "currentStatus": "playing",
        "facts": { "lastPlayedAt": "2026-10-12T18:00:00.000Z", "statusChangedAt": "2026-09-01T10:00:00.000Z", "platinumEarnedAt": "2026-10-12T17:40:00.000Z", "daysSinceLaunch": 20 },
        "game": { "...": "GameItem (9.1), включая linkedVersions" }
      }
    ]
  }
}
```
- `count` = `items.length`. Порядок: по приоритету правила (`platinum`, `returned`, `started`, `stale`), внутри `lastPlayedAt` убыванию (null в конце), затем `gameId`.
- `currentStatus`: `playing | completed | dropped | backlog | shelved | null` (`service` в подсказки не попадает).
- `facts.*` ISO UTC или `null`; `daysSinceLaunch` = целые сутки от `lastPlayedAt` до `now`, `null` без запуска. `reason` короткая RU-строка (даты по Europe/Moscow), UI может её показать или собрать свою из `facts`.
- 503 `db_unavailable`. Пустой список: `{ "count": 0, "items": [] }`.

### 28.5 `GET /api/status-hints/count`

Тот же расчёт, ответ `{"ok":true,"data":{"count":N}}` (бейдж вкладки/кнопки «Проверить»; без GameItem). 503 `db_unavailable`.

### 28.6 `POST /api/status-hints/dismissals`

Сессия, проверка Origin как у других мутаций. Тело (`application/json`, строгий объект): `{ "gameId": <целое>, "rule": "started" | "stale" | "platinum" | "returned" }`. Отказ записывается, идемпотентен (повтор тоже 200).
- 200: `{"ok":true,"data":{"gameId":17,"rule":"platinum"}}`.
- 400 `invalid_request`: тело не объект, лишние поля, `gameId` не целое, `rule` не из списка, Origin не тот. 404 `not_found`: нет игры или игра чужая (то же тело, что у несуществующей). 503 `db_unavailable`.
Отказ действует навсегда для пары (игра, правило); остальные правила для игры продолжают работать.

### 28.7 `DELETE /api/status-hints/dismissals/{gameId}/{rule}`

Отмена отказа («Вернуть подсказку», «Отменить» после нажатия). Идемпотентен: нет такого отказа тоже 200. 200: `{"ok":true,"data":{"gameId":17,"rule":"platinum"}}`. 400 `invalid_request` (id не число, rule не из списка, Origin), 503. Чужая игра: 200 без эффекта (удаление идёт с `user_id` сессии, чужие строки недостижимы), тело как у несуществующего отказа.

### 28.8 Изоляция, проверки
- Любой SELECT/INSERT/DELETE по играм, статусам, трофеям и отказам несёт `user_id` пользователя. Тест `src/server/sync/status-hints-db.test.ts`: два пользователя с одинаковыми играми, отказ одного не влияет на другого, чужой `gameId` даёт 404.
- Тесты правил: `src/server/sync/status-hints.test.ts` (фикстуры: DLC-платина, PS4 + PS5, перепрохождение, дубли, границы по датам).
- Пересчёт на лету: 3 запроса (игры, статусы+отказы, сеты платины) на пользователя; игр сотни, кэша нет.
- Риски: платина без статуса у старых игр даст пачку подсказок «Пройдено?» при первом открытии (разбирается один раз, отказ/смена статуса снимает); `last_played_at` приходит из PSN раз в сутки, подсказка «Играю?» запаздывает до суток.

### 28.9 Откат «Принять» и проверка конфликта в `PUT /api/games/{id}/status` (Фаза 28, QA-27-1, QA-27-3)

Миграции нет. Расширение 9.4 двумя НЕОБЯЗАТЕЛЬНЫМИ полями тела; без них поведение 9.4 не меняется. Новых роутов нет, Origin/сессия/`user_id` как у 9.4.

Тело: `{ "status": <значение|null>, "expectedStatus"?: <значение|null>, "restore"?: { "status": <значение>, "statusChangedAt": <ISO>, "completedAt": <ISO|null>, "droppedAt": <ISO|null> } }`.

**`expectedStatus`** (QA-27-3, оптимистичная проверка). Ключ есть: перед записью текущий статус игры (`null` = нет строки `game_status`) сравнивается с ним; не равен: `409 status_conflict`, `details: {"status": <текущий статус|null>}`, ничего не записано. Ключа нет: проверки нет. Значение не из списка статусов и не `null`: 400. Очередь подсказок передаёт `currentStatus` подсказки.

**`restore`** (QA-27-1, откат). Восстанавливает прошлую строку `game_status` целиком, без правил 1.3 (даты не пересчитываются, `statusChangedAt` не ставится в `now`).
- Берётся клиентом ДО «Принять»: `status` = `currentStatus` подсказки, `statusChangedAt` = `facts.statusChangedAt` подсказки, `completedAt`/`droppedAt` = `game.completedAt`/`game.droppedAt` из `GameItem` подсказки.
- Условия: `restore.status` обязан совпадать с `status` тела (иначе 400); `restore.status` не `null` (если прошлого статуса не было, откат = обычный `{"status": null}`, строка удаляется); `statusChangedAt` обязателен; даты ISO с `Z`/смещением или `null`; лишние ключи в `restore` = 400; `completedAt` допустим только при `completed`, `droppedAt` только при `dropped` (иначе 400). Даты в будущем не проверяются (значения уже были в БД).
- Сочетается с `expectedStatus`: откат после «Принять: Играю» шлёт `{"status":"dropped","expectedStatus":"playing","restore":{...}}`; если за это время статус сменили в другом месте, 409 и откат не затирает чужое изменение.
- 200: `{"ok":true,"data":{"game":{GameItem}}}`. После отката строка статуса равна исходной, подсказка того же правила возвращается при следующем `GET /api/status-hints` (если условия правила не изменились). Бэклог: при `restore.status = backlog` запись `roadmap_order` игры сбрасывается как в 9.4 (позиция плана не восстанавливается, ограничение).
- Порядок проверок: id и тело (400) -> игра (404) -> `expectedStatus` (409) -> запись.
- `POST /api/games/status-bulk` не меняется.
- Тесты: `src/server/sync/status-hints-qa.test.ts` (откат на БД: статус и даты совпадают с исходными, подсказка возвращается; конфликт; изоляция по `user_id`), маршрутные проверки валидации там же.

## Фаза 28. «Входящие»: полоса «С прошлого визита»

Миграции нет, таблиц нет, запись в БД не делается. Чтение, сессия (`requireUser`), `userId` из сессии, КАЖДАЯ выборка с `user_id` (запрос без фильтра по пользователю = баг). Согласовано с `docs/design/spec-phase-28-inbox.md` (A.1) и сообщением оркестратора. «Что нового» (подсказки о новых фичах, «показано один раз») хранится на клиенте (localStorage, ключ с `user.id`), сервер не участвует. Риск: другой браузер/устройство или очистка данных покажет подсказки снова; на данные не влияет (серверное хранение = отдельная миграция).

### F28.1 `GET /api/inbox`

Без параметров. Окна фиксированные: 24 ч и 7 сут, скользящие, `(now - окно, now]` в UTC, нижняя граница строгая (`>`), событие ровно на границе не входит, `now` входит. Для `newGames` и `trophies` сервер выбирает окно сам: `24h`, если в нём что-то есть, иначе `7d`; какое сработало, возвращается в `newGamesWindow` / `trophiesWindow` (`null`, если за 7 сут нет ничего). Недели и даты снимков по Europe/Moscow (UTC+3): текущая неделя = 7 дат МСК, заканчивающихся сегодня (`today-6..today`), прошлая = `today-13..today-7`. `503 db_unavailable` только если упали ВСЕ части.

200 (`data`):
```json
{
  "now": "2026-11-01T12:00:00.000Z",
  "newGames": 3, "newGamesWindow": "24h", "newUnsorted": 2,
  "trophies": 14, "platinums": 1, "trophiesWindow": "24h",
  "hoursWeek": 12.4, "hoursPrevWeek": 8.0, "hoursNoHistory": false,
  "checkCount": 4,
  "forgottenCount": 7,
  "partial": false, "failed": [], "isEmpty": false
}
```

### F28.2 Определения

- `newGames`: видимые игры (не скрыты, не дубль) с `first_seen_at` в окне `newGamesWindow`, КРОМЕ первой загрузки: игры, впервые увиденные в первом синке пользователя (`first_seen_at <=` конец самого раннего УСПЕШНОГО запуска `sync_runs` со `status = 'success'`: `finished_at`, иначе `started_at + 1 ч`; упавшие и частичные запуски не считаются первой загрузкой; успешных запусков нет: `min(first_seen_at) + 1 ч`). Иначе первый синк дал бы «+214 новых». `newUnsorted` («Разобрать M») = те же игры, у которых сейчас нет строки `game_status`; `M <= N`.
- `trophies`: полученные трофеи (`earned = true`) с `earned_at` в окне `trophiesWindow`, только сеты, учитываемые в статистике (`trophySetCounted`: сеты скрытых игр не считаются), трофеи без `earned_at` не считаются. `platinums` (входит в `trophies`): каждая полученная платина как событие. DLC-платина (отдельный сет-дополнение) считается платиной и НЕ схлопывается с платиной базы; PS4 и PS5 версии с собственными платинами это два трофея.
- `hoursWeek` / `hoursPrevWeek`: часы по `playtime_snapshots` (дельта снимков, как в статистике: дубли склеены в главную, отрицательная дельта = 0), 2 знака. Оценка Фазы 6 не используется. `hoursNoHistory = true`, если снимков у пользователя нет вообще: тогда обе величины `null`. `hoursPrevWeek = null` (при `hoursNoHistory = false`), если первый снимок не раньше начала прошлой недели (прошлая неделя неполная, сравнения нет; `hoursWeek` при этом показывать можно, первая неделя истории занижена на день-два).
- `checkCount`: число подсказок смены статуса (`countStatusHints`, раздел 28). `forgottenCount`: «Забытые» (`forgottenSql`, 14.4, 90 суток). Оба от окон не зависят.
- `isEmpty`: нули у всех успешно посчитанных частей: `newGames`, `trophies`, `hoursWeek` (null считается 0), `checkCount`, `forgottenCount`. `newUnsorted` отдельно не участвует (часть `newGames`).

### F28.3 Частичный ответ

Части для флагов: `newGames` (поля `newGames`, `newGamesWindow`, `newUnsorted`), `trophies` (`trophies`, `platinums`, `trophiesWindow`), `hours` (`hoursWeek`, `hoursPrevWeek`, `hoursNoHistory`), `checkCount`, `forgottenCount`. Упавшая часть: её поля `null`, имя в `failed`, `partial = true`. Упавшие части в `isEmpty` не входят (все упали: `isEmpty: true`, `partial: true`, но тогда роут отвечает 503).

Тесты: `src/server/inbox/inbox.test.ts` (чистая часть), `src/server/inbox/inbox-db.test.ts` (PGlite: пусто, полно, границы окон, 24 ч -> 7 дн., первая загрузка, DLC-платина, изоляция двух пользователей, частичный сбой, роут).

## Фаза 29. Сводка в Telegram (миграция 0021)

Недельная сводка в чат Telegram. Тексты и правила сборки: `docs/design/spec-phase-29-digest.md` (источник истины для строк). Здесь схема, запуск, API, идемпотентность.

### F29.1 Схема (миграция `0021_telegram_digest`, expand: только новые таблицы)

Все таблицы с `user_id` -> `allowed_users(id)` ON DELETE CASCADE.

| Таблица | Колонки | Ограничения |
|---|---|---|
| `telegram_chats` | `user_id` int PK, `chat_id` text NOT NULL, `linked_at` timestamptz NOT NULL default now() | UNIQUE(`chat_id`): один чат привязан к одному пользователю; CHECK `chat_id ~ '^-?[0-9]{1,20}$'` |
| `telegram_link_codes` | `user_id` int PK, `code_hash` text NOT NULL, `expires_at` timestamptz NOT NULL, `created_at` timestamptz NOT NULL default now() | UNIQUE(`code_hash`); у пользователя не больше одного живого кода (новый заменяет старый) |
| `telegram_link_attempts` | `id` int identity PK, `chat_id` text NOT NULL, `attempted_at` timestamptz NOT NULL default now() | индекс (`chat_id`, `attempted_at`); неверные попытки привязки по `chat_id` и создания кодов по служебному ключу `user:<id>` (лимит F29.7) |
| `digest_state` | `user_id` int PK, `last_sent_at` timestamptz NULL, `last_week` text NULL (понедельник недели МСК, `YYYY-MM-DD`), `last_advice_game_id` int NULL | служебное: «последняя сводка» для сайта и совет «не из прошлой сводки» |

Код привязки хранится только как `sha256(код)`; открытый код живёт 15 минут и показывается один раз в ответе создания.

### F29.2 Запуск (ограничение Vercel Hobby)

Hobby: не больше 2 cron-заданий и только раз в сутки. Оба заняты (`/api/cron/sync`, `/api/cron/watchdog`), третье добавить нельзя. Решение: сводку запускает существующий cron watchdog, а его расписание переносится с `0 6 * * *` на `0 16 * * *` (16:00 UTC = 19:00 МСК, «воскресенье вечер»). Цена: алерт «синк не запускался» приходит на 10 ч позже (в 19:00 МСК вместо 09:00; порог 30 ч не меняется), еженедельная копия разметки (20.3) тоже уходит вечером. Синк идёт в 23:00 МСК, поэтому в воскресенье в 19:00 сводка видит данные до субботнего синка: воскресные часы и трофеи, ещё не загруженные из PSN, в неё не попадут и лягут в следующую неделю (по `earned_at` трофей воскресенья относится к уже ушедшей неделе и в следующей сводке не учитывается). Это принятая неточность; в тексте сводки не обещаем «до конца воскресенья».

- В `GET /api/cron/watchdog`: если сейчас воскресенье МСК, после алерта и копии запускается сводка. Понедельник МСК: догоняющий запуск за ПРОШЛУЮ неделю (если сводка пользователя за неё не ушла: Telegram лежал, пользователь привязался после). Остальные дни сводка не запускается.
- `GET /api/cron/digest` (Bearer `CRON_SECRET`): тот же запуск вручную, без проверки дня недели при `?force=1` (неделя = текущая по МСК). Для проверки владельцем и отладки; `maxDuration = 60`. Ответ как `digest` ниже.
- `maxDuration` watchdog поднят с 30 до 60. Пользователи обрабатываются последовательно; бюджет 40 с на сводки, не успевшие остаются без отметки (`skipped`) и уйдут на догоняющем запуске в понедельник.
- Ответ watchdog получает поле `digest` (`null`, если не воскресенье/понедельник):
```json
"digest": { "week": "2026-10-26", "results": [ { "userId": 1, "result": "sent" } ] }
```
`result`: `sent | already_sent | no_target | telegram_disabled | send_failed | skipped | error`. `no_target`: у участника нет привязанного чата.

### F29.3 Получатели

- Участник (`member`): только в привязанный чат (`telegram_chats`). Нет привязки: `no_target`, ничего не отправляется.
- Владелец (`owner`): в привязанный чат, если он привязал свой; иначе в `TELEGRAM_CHAT_ID` (чат алертов), привязка не нужна. Отключить сводку владельцу можно только убрав `TELEGRAM_CHAT_ID`.
- Нужны `TELEGRAM_BOT_TOKEN` (общий бот). Нет токена: `telegram_disabled`.
- Блокированные пользователи (`status <> 'active'`) сводку не получают.

### F29.4 Идемпотентность

Ключ `notify_log.kind = 'digest:<userId>:<понедельник недели МСК>'`. Отметка ставится атомарно ДО отправки: `INSERT ... ON CONFLICT (kind) DO NOTHING RETURNING`; вернулась строка = мы владеем отправкой, нет = `already_sent` (двойной запуск, параллельные запуски, догоняющий запуск после успеха). Отправка неудачна или любое исключение: отметка удаляется (`DELETE ... WHERE kind = ? AND last_sent_at = <наш now>`), повтор возможен. После успеха обновляется `digest_state` (`last_sent_at`, `last_week`, `last_advice_game_id`); сбой этой записи не откатывает отправку. Старые ключи `digest:*` старше 10 недель удаляются при запуске.

### F29.5 Содержимое и источники данных

Все выборки несут `user_id` и общий фильтр видимости (`snapshotGameVisible`, `trophySetCounted`, `visibleGames`, дубли склеены). Блок собирается независимо: исключение при сборе блока = блок пропущен, остальные отправляются. Неделя = пн 00:00 – вс 23:59:59 МСК (`[mskMidnightUtc(пн), mskMidnightUtc(пн+7))`); «прошлая» на 7 дней раньше.

| Блок | Источник | «Нет данных» |
|---|---|---|
| Часы | `playtime_snapshots`, `secondsByGame` по датам МСК, дельта снимков, отрицательная = 0 | `week = null`, если снимков нет вообще или первый снимок позже воскресенья недели; `prevWeek = null`, если первый снимок не раньше понедельника прошлой недели (неполная). `null` не равно 0: текст «нет данных», не «0 ч» |
| Трофеи | `trophies.earned_at` в границах недели; платины с названием игры (минимальный id видимой игры набора, как в статистике) | сеты скрытых игр не считаются |
| План | `getRoadmap`: `progress.status`/`diffHours` (`ahead`/`behind`/`onTrack`), `items` недели после целевой; `plan.status = 'ok'` и есть записи | блок пропущен |
| Совет | `getRecommendations(time='any')`, топ-1, id не равен `digest_state.last_advice_game_id`; LLM не вызывается (фраза из кэша синка или шаблон) | блок пропущен |
| Статусы | `getInbox`: `checkCount + newUnsorted` | блок пропущен при 0 или сбое обеих частей |

Отклонение от спеки designer (согласовать): «Отстаёшь/Опережаешь» в сводке выражено в ЧАСАХ (`progress.diffHours`), а не в играх: прогресс Плана в бэкенде считается в часах (17.6), числа «игр от графика» в данных нет. Строки: «Отстаёшь от графика на {X}.», «Опережаешь график на {X}.», «Идёшь по графику.» (X в формате «12 ч 30 м»); при `no_data`/`not_started` строка состояния не выводится, список недели остаётся.

Ссылки: `{APP_ORIGIN}/?game=<id>` через `gameLink`; нет `APP_ORIGIN` (или id) = без ссылок. Служебные ссылки (`/`, `/triage?mode=check`) только при `APP_ORIGIN`. Длина: усечение по порядку из спеки (п. 0), жёсткий предел 3500 символов. Plain text, без `parse_mode`.

### F29.6 Привязка чата

Выбран webhook, не `getUpdates`: `getUpdates` требует опроса по таймеру (нет свободного cron на Hobby), а webhook отвечает сразу. Артём один раз регистрирует его (`setWebhook` с `url=<APP_ORIGIN>/api/telegram/webhook` и `secret_token=<TELEGRAM_WEBHOOK_SECRET>`, ссылкой из браузера; инструкция в `docs/release.md`).

`POST /api/telegram/webhook` (публичный путь в `proxy.ts`, без сессии; свой секрет):
- Заголовок `X-Telegram-Bot-Api-Secret-Token` сверяется с `TELEGRAM_WEBHOOK_SECRET` (сравнение без утечки по времени). Нет секрета в env, нет заголовка или не совпал: `401 unauthorized`, тело не читается. Токены и секрет не логируются.
- Обрабатывается только `message.text` из приватного чата (`chat.type = 'private'`); остальное: `200 {"ok":true}` без действий. Любой обработанный апдейт отвечает `200` (чтобы Telegram не ретраил), ошибки БД тоже `200`, ответ пользователю в чат не отправляется.
- `/start <код>` (код `A-Z0-9` без `0/O/1/I`, 8 символов, регистр не важен): верный -> запись `telegram_chats`, код удаляется, ответ бота по спеке 3. Неверный/просроченный/использованный/чат уже привязан/лимит: ответы из спеки 3. Лимит: 5 неверных попыток за 10 минут на `chat_id` (`telegram_link_attempts`), дальше ответ «Слишком много попыток» без проверки кода.
- `/stop`: удаляет привязку этого чата. `/start` без кода и прочий текст: подсказка. Команды с суффиксом `@бот` понимаются.
- Ответы бота: `sendMessage` в `message.chat.id`, plain text.

### F29.7 API сайта (сессия, `requireUser`; запись требует `originAllowed`)

`GET /api/me/telegram`:
```json
{ "botConfigured": true, "botUsername": "ps_tracker_bot", "role": "member", "linked": true, "linkedAt": "2026-11-01T10:00:00.000Z",
  "deliversTo": "own_chat", "lastSentAt": "2026-10-25T16:00:12.000Z", "pendingCode": { "expiresAt": "2026-11-01T10:15:00.000Z" } }
```
`deliversTo`: `own_chat` (привязанный), `alerts_chat` (владелец без привязки при заданном `TELEGRAM_CHAT_ID`), `none`. `botUsername`: из `TELEGRAM_BOT_USERNAME` (без `@`) или `null`. `pendingCode`: `null`, если нет живого кода (сам код не отдаётся повторно). `botConfigured = false`: нет `TELEGRAM_BOT_TOKEN` или `TELEGRAM_WEBHOOK_SECRET` (привязка не заработает).

`POST /api/me/telegram/link` (тело пустое или `{}`) -> `{ "code": "K7M2QX9H", "expiresAt": "...", "deepLink": "https://t.me/ps_tracker_bot?start=K7M2QX9H" | null }`. Заменяет прежний код. `503 config_error`, если бот не настроен. Не чаще 5 созданий за 10 минут на пользователя (`429 rate_limited`).

`DELETE /api/me/telegram` -> `{ "linked": false }`: удаляет привязку и живой код. Идемпотентен. Владелец после отвязки получает сводку в чат алертов.

Ошибки: `401 unauthorized`, `503 db_unavailable`, `503 config_error`, `429 rate_limited`.

### F29.8 Переменные окружения

| Переменная | Обязательна | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | для сводки | уже используется алертами; токен общий |
| `TELEGRAM_WEBHOOK_SECRET` | для привязки | 16–256 символов `A-Za-z0-9_-`, тот же передаётся в `setWebhook` |
| `TELEGRAM_BOT_USERNAME` | нет | для ссылки `t.me/<ник>?start=<код>` |
| `APP_ORIGIN` | нет | абсолютные ссылки в сводке; без него ссылок нет (задаёт Артём) |

### F29.9 Тесты

`src/server/digest/*.test.ts` (текст на фикстурах спеки 6.1–6.3, границы недели МСК, склонения, усечение, без origin), `digest-db.test.ts` (PGlite: идемпотентность и параллельный запуск, откат при сбое, изоляция двух пользователей, пропуск блока при сбое сборки, получатели), `link.test.ts` (привязка, неверный/просроченный/повторный код, лимит, отвязка, чужой чат), `src/app/api/telegram/webhook/route.test.ts` (секрет), `src/db/release-sql-0021.test.ts`.

## Фаза 40. «Уже есть»: отметки внешних игр и связь «одна игра → много» (миграция 0024)

Игра в «У тебя нет», которая на деле есть (в составе сборника библиотеки) или уже пройдена вне библиотеки, помечается и пропадает из выдач кандидатов RAWG. Решение Артёма 2026-11-01: отметка «прошёл» НЕ меняет саму подборку (вкус, жанры, скоринг RAWG считаются по тем же данным), она только исключает игру из выдач. В Статистику и Итоги отметка не попадает (часов и трофеев по ней нет).

### 40.1 Схема (миграция `0024_owned_marks`, только добавляет таблицу)
```
owned_marks
  user_id              integer NOT NULL  FK allowed_users(id) ON DELETE CASCADE
  rawg_id              text    NOT NULL                       -- ключ внешней игры (externalId RAWG)
  title                text    NOT NULL  CHECK 1..200
  title_key            text    NOT NULL                       -- libraryKey(title): нормализованное название, только для справки/диагностики, в фильтрах НЕ участвует
  cover_url            text    NULL
  covered_by_game_id   integer NULL      FK (user_id, covered_by_game_id) -> games(user_id, id) ON DELETE CASCADE
  completed            boolean NOT NULL DEFAULT false
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (user_id, rawg_id)                              -- уникальность (user_id, rawg_id)
  CHECK owned_marks_covered_completed: covered_by_game_id IS NULL OR completed = false
  INDEX owned_marks_user_covered_idx (user_id, covered_by_game_id) WHERE covered_by_game_id IS NOT NULL
```
- Связь 1 -> много: у одной игры библиотеки (`games.id`) может быть много отметок (`covered_by_game_id` одинаков). Составной FK гарантирует на уровне БД, что покрывающая игра принадлежит тому же `user_id`.
- Два вида отметки: `covered` (`covered_by_game_id IS NOT NULL`, `completed = false`) и `not_in_library` (`covered_by_game_id IS NULL`, `completed` true/false: «прошёл» или просто «есть/не интересует»).
- Игра библиотеки удалена из БД (сейчас не бывает): отметки `covered` каскадно исчезают, игра может вернуться в выдачу.
- `docs/release-neon-0024.sql` идемпотентен, пишет в журнал drizzle; `docs/release-neon-0024-check.sql` для проверки до/после. Миграция на прод применяется Артёмом через Neon SQL Editor.

### 40.2 Роуты (сессия `requireUser`; запись требует `Content-Type: application/json` и проверку Origin; везде `user_id` сессии)

Тип отметки в ответах:
```
OwnedMark = {
  externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null;
  kind: 'covered' | 'not_in_library';
  completed: boolean;                       // для covered всегда false
  coveredBy: { gameId: number; name: string; imageUrl: string | null } | null;   // для not_in_library null
  createdAt: string; updatedAt: string      // ISO
}
```

`PUT /api/owned-marks` — создать или обновить отметку (upsert по `(user_id, externalId)`, идемпотентно). Тело, все поля обязательны, лишние = 400:
```
{ "externalSource": "rawg", "externalId": "3328", "title": "Uncharted 3", "coverUrl": "https://..." | null,
  "kind": "covered", "coveredByGameId": 123 }
{ "externalSource": "rawg", "externalId": "3328", "title": "Uncharted 3", "coverUrl": null,
  "kind": "not_in_library", "completed": true }
```
Поля `externalId`, `title`, `coverUrl` как в 30.5. Для `covered` поле `completed` не передаётся (иначе 400), для `not_in_library` `coveredByGameId` не передаётся (иначе 400). `coveredByGameId` int >= 1.
- `covered`: игра должна существовать у этого пользователя (скрытая допустима). Чужая и несуществующая игра дают одинаковый ответ `404 not_found` (наличие чужой игры не раскрывается). Если выбрана игра-дубль (Фаза 23), связь пишется на главную (`duplicate_of_game_id`).
- Повторный PUT меняет вид отметки (`not_in_library` -> `covered` и обратно), `created_at` сохраняется, `updated_at` обновляется. Это также «выбор сборника одним тапом» для следующей игры: тот же `coveredByGameId`.
- `200 { ok, data: { mark: OwnedMark } }`. Ошибки: `400 invalid_request`, `401`, `404 not_found`, `503 db_unavailable`.

`DELETE /api/owned-marks/{externalId}` — «Вернуть в подборку». Идемпотентно, проверка Origin, удаляет только запись этого пользователя. `200 { ok, data: { externalId, removed: boolean } }` (`removed = false`: отметки не было, в том числе у другого пользователя ту же `externalId` затронуть нельзя). Игра возвращается в выдачу «У тебя нет» сразу: следующий `GET /api/recommend/discover` содержит её (если она проходит правила подборки и есть в кэше), без пересчёта и без запросов к RAWG (фильтр на чтении, 40.3). Клиенту достаточно перезапросить `GET /api/recommend/discover`; оптимистично вставлять карточку не нужно, но можно, пока идёт запрос. Исключение: отметка, поставленная до выкладки этой правки и учтённая в уже пересчитанном кэше, вернётся после следующего пересчёта.

`GET /api/owned-marks` — все отметки пользователя, новые сверху (`updatedAt` убыв., затем `externalId`). `200 { ok, data: { marks: OwnedMark[] } }`. Для экрана «Отмеченные» и отмены.

`GET /api/owned-marks/recent-collections?limit=5` — «недавно выбранные сборники» для приоритета в списке выбора. `limit` 1..10, по умолчанию 5. Игры библиотеки пользователя, у которых есть отметки `covered`, по последнему использованию (`max(updated_at)` убыв., затем `gameId`); скрытые и дубли не показываются.
`200 { ok, data: { collections: { gameId: number; name: string; imageUrl: string | null; coveredCount: number; lastUsedAt: string }[] } }`.

`GET /api/owned-marks/library-search?q=uncharted&limit=20` — поиск по библиотеке для выбора сборника. `q` 1..80 символов после trim (пустой или длиннее = 400), поиск без учёта регистра по `games.name` и `games.hltb_name` как подстрока (`%` и `_` в `q` экранируются); `limit` 1..30, по умолчанию 20. Только видимые игры пользователя (не скрытые, не дубли). Порядок: название начинается с `q`, затем по названию, затем по `id`.
`200 { ok, data: { games: { id: number; name: string; imageUrl: string | null; coveredCount: number }[] } }`.

Ошибки общие: `401 unauthorized`, `400 invalid_request` (в том числе неверный Origin), `503 db_unavailable` (без текста исключения и без секретов).

### 40.3 Исключение из выдач кандидатов RAWG
Фильтр по `owned_marks.rawg_id` этого пользователя (любой вид отметки, срока нет). Ключ только RAWG id: совпадение названия без совпадения id игру не скрывает. Действует при чтении, не дожидаясь пересчёта:
- `GET /api/recommend/discover` (30.2) и пересчёт подборки (30.3/30.4): отмеченные в пул и ранжирование ПОПАДАЮТ (кэш подборки от отметок не зависит) и скрываются только при выдаче; поэтому отмена возвращает карточку без пересчёта. Остальные исключения (библиотека, План, дизлайки) по-прежнему отсекаются при пересчёте.
- `GET /api/roadmap/catalog/upcoming` (17.13) и `GET /api/roadmap/catalog/search` (17.9): отмеченные убираются из `candidates`. Параметры страницы (`page`, `hasMore`) не меняются, страница может быть короче обычной. Поиск тоже фильтруется: игра, которую пользователь уже отметил как имеющуюся, в План не предлагается; «Вернуть в подборку» снимает фильтр.
- «Подскажи» (раздел 18) кандидатов RAWG не содержит (только бэклог библиотеки), отметки на него не влияют.

Что отметка НЕ меняет: `loadHistory`, профиль вкуса, жанры и аффинити, фасеты запроса, `score` и порядок остальных кандидатов, причины, `games`/`game_status`, Статистику, Итоги, Wrapped, счётчики RAWG/LLM. Резервная копия разметки отметки не включает (внешние игры, не библиотека).

### 40.4 Изоляция и проверки
- `owned_marks` добавлена в охранный тест `user-scope` (`USER_TABLES`), все выборки и записи с `user_id`.
- Тесты: `src/server/owned/*.test.ts` (PGlite: изоляция двух пользователей, нельзя покрыть чужой игрой, нельзя удалить чужую отметку, 1 -> много, смена вида, отмена, дубль -> главная, поиск и недавние сборники, исключение из discover/roadmap, вкус и скоринг не меняются), `src/app/api/owned-marks/*.test.ts` (роуты: валидация, Origin, 401, 404, 503 без утечек), `src/db/release-sql-0024.test.ts`.

## Фаза 41. Несколько профилей PSN у одного входа (миграция 0025)

Отход от «один вход = один пользователь» (решение Артёма 2026-11-01): к одной почте привязано до N профилей PSN, у каждого своя коллекция, трофеи, План, статусы. Подход: профиль PSN = строка `allowed_users` (как в Фазе 20), `user_id` во всех данных остаётся id профиля, таблицы Фазы 20 не меняются. Вход (почта, Google, блокировка, роль) = «основной» профиль; переключатель только выбирает, какой профиль считать активным. Существующий код, получающий `UserId` из `requireUser`, не меняется: `user.id` теперь id активного профиля. Меняют поведение только: auth/сессия, `users.ts`, «Доступ», cron-обход (проверка входа), digest/Telegram, лимиты.

Термины: **вход** (login) = основной профиль + его дополнительные; **основной профиль** (primary) = строка с `primary_user_id IS NULL`, все существующие строки; **дополнительный** = строка с `primary_user_id = <id основного>`.

### 41.1 Схема (миграция `0025_psn_profiles`, только expand)

Изменения только в `allowed_users`:
| Что | Решение |
|---|---|
| `primary_user_id integer NULL` FK `allowed_users(id)` ON DELETE CASCADE | NULL = строка основная. Не NOT NULL = `id`: у основной строки `id` неизвестен при INSERT (identity), а NULL не требует перезаписи 3 прод-строк. Вход строки = `coalesce(primary_user_id, id)` |
| `archived_at timestamptz NULL` | момент отвязки профиля (41.4) |
| CHECK `status` | к `invited\|active\|blocked` добавляется `archived` (drop + add constraint) |
| CHECK `allowed_users_profile_check` | `primary_user_id IS NULL OR (primary_user_id <> id AND role = 'member' AND google_sub IS NULL)`; `(status = 'archived') = (archived_at IS NOT NULL)`; `status = 'archived' -> primary_user_id IS NOT NULL` |
| unique `email` | `allowed_users_email_key` заменяется частичным `allowed_users_email_primary_key` unique(`email`) WHERE `primary_user_id IS NULL` (сначала создать новый, потом удалить старый). У дополнительных профилей `email` = копия почты входа (колонка NOT NULL), для поиска и входа НЕ используется |
| unique `google_sub`, single-owner | без изменений (у дополнительных `google_sub` пуст). Owner один и всегда основной (CHECK выше) |
| unique PSN | `allowed_users_psn_account_key` unique(`psn_account_id`) WHERE not null AND `status <> 'archived'`; `allowed_users_psn_online_key` unique(`lower(psn_online_id)`) WHERE not null AND `status <> 'archived'`. Один аккаунт PSN не может быть в двух профилях, даже у разных входов. До создания индексов release-SQL проверяет дубли и падает с `RAISE EXCEPTION` без изменений |
| индекс | `allowed_users_primary_idx (primary_user_id) WHERE primary_user_id IS NOT NULL` |

Инвариант «основной не вложен» (`primary_user_id` указывает только на строку с `primary_user_id IS NULL`) в БД не выражается (FK не работает с частичным ключом): проверяет приложение (транзакция + advisory lock 7204002, как `createMember`), `release-neon-0025-check.sql` и тест. Остальные таблицы, `login_attempts`, `notify_log`, `psn_auth`, `telegram_*` не меняются.

Роли: в строке дополнительного профиля `role` всегда `member`. **Роль входа** (права: «Доступ», NPSSO, чужие данные не открывает) = `role` основной строки; `AuthedUser.role` = роль входа, `AuthedUser.profileRole` = `role` строки активного профиля. Логика «владелец без ника берёт `PSN_TARGET_ONLINE_ID`» (22.12) и получатель сводки (F29.3) смотрят на `profileRole`/строку, а не на роль входа: дополнительный профиль владельца не подставляет `PSN_TARGET_ONLINE_ID` и сводку не получает.

Статус входа живёт на основной строке; блокировка входа ставит `blocked` на ВСЕ его не-архивные строки одной транзакцией (cron и digest фильтруют по `status = 'active'` и без правки остаются корректны), разблокировка возвращает `active`. Дополнительный профиль создаётся сразу `active`. `tour_version`/`tour_completed_at` копируются с основной строки при создании (тур не повторяется). `onboarded_at` у каждого профиля свой.

### 41.2 Сессия

Cookie `pst_session` остаётся `v:2`: `{"v":2,"uid":<id основного профиля = вход>,"pid":<id активного профиля, необязательно>,"role","amr","iat","exp"}`. Нет `pid` = `pid = uid`. Все действующие cookie (без `pid`) работают без перелогина. Откат кода безопасен: старый код игнорирует `pid` и открывает основной профиль. `proxy.ts` проверяет подпись, срок и форму (`pid`, если есть, целое > 0), без БД.

`requireUser` на КАЖДОМ запросе одним запросом читает строку профиля `p` (id = `pid ?? uid`) и основную строку `c` (id = `coalesce(p.primary_user_id, p.id)`):
| Условие | Результат |
|---|---|
| `c.id <> uid`, или `c` не основная, или `c.status <> 'active'` | `401 unauthorized`, cookie очищается (вход заблокирован/удалён, либо профиль чужого входа) |
| `p` не найден или `p.status = 'archived'` (профиль удалён/отвязан при живой сессии) | запрос обслуживается как основной профиль (`pid = uid`), cookie не переписывается; UI берёт актуальный `activeProfileId` из `GET /api/auth/me` |
| `p.status <> 'active'` (иначе) | `401`, cookie очищается |
| всё верно | `AuthedUser { id: p.id, loginId: c.id, role: c.role, profileRole: p.role, amr, row: p }` |

Роль и `status` по-прежнему берутся из БД, не из cookie. `pid` из тела, query и path не принимается никогда; выбрать профиль можно только 41.3 (`POST /api/me/profiles/active`).

Срок: переключение выдаёт новый токен с тем же `iat`/`exp` (срок не продлевается; `reissueSessionToken`); `Max-Age` новой cookie = остаток жизни токена, а не 30 дней. `pid = uid` в токене нормализуется (поле опускается). Выход очищает cookie целиком. Вход (Google, `ADMIN_PASSWORD`) всегда открывает основной профиль (`uid`, без `pid`); «запомнить последний профиль» вне Фазы 41. Вход по `ADMIN_PASSWORD` = `uid` владельца (основной, `id = 1`); владелец переключается как обычно.

Поиск при входе (`lookupForLogin`, `completeLogin`, `bootstrapOwner`, `getOwner`, `createMember`) обязан фильтровать `primary_user_id IS NULL`: иначе по email найдётся дополнительная строка.

### 41.3 API (сессия `requireUser`; запись требует `application/json` и Origin; ошибки конверта 4.1)

Тип профиля:
```
Profile = { id: number; isPrimary: boolean; onlineId: string | null; accessStatus: string;
            onboardedAt: string | null; canStartSync: boolean; gamesCount: number; lastSyncAt: string | null }
```

`GET /api/me/profiles` -> `{ loginId, activeProfileId, limit: 3, canAdd: boolean, profiles: Profile[], archived: { id, onlineId, archivedAt, purgeAt }[] }`. `profiles` = все `active` строки входа сессии (`coalesce(primary_user_id,id) = loginId`), основной первым, дальше по `id`; чужие профили не попадают никогда. `canAdd` = активных < лимита и не исчерпан `MAX_USERS`.

Формы ответов `POST /api/me/profiles`: `201 { profile: Profile, activeProfileId }`; восстановление `200 { profile, restored: true, activeProfileId }`. `DELETE`: `200 { archived: true, activeProfileId }` или `{ purged: true, activeProfileId }`. `POST /active`: `200 { activeProfileId, profile }`.

`GET /api/auth/me` (22.4) дополняется: `id` = активный профиль (как раньше для остального UI), `loginId`, `activeProfileId`, `role` = роль входа, `profiles: { id, onlineId, isPrimary }[]` (лёгкий список для переключателя в шапке; счётчики не считаются).

`POST /api/me/profiles/active` `{ profileId: int }` -> 200 `{ activeProfileId, profile }` + новая `Set-Cookie` (41.2). Идемпотентно. Чужой, несуществующий, архивный профиль: одинаково `404 not_found`. `400 invalid_request`, `401`.

`POST /api/me/profiles` `{ onlineId: string, activate?: boolean (по умолчанию true) }` — добавить профиль PSN (привязывать может и owner, и member). Порядок: сессия -> Origin/JSON -> формат ника (как у 22.13) -> лимиты -> проверка PSN. Проверка PSN та же, что у `PUT /api/me/psn` (22.13: технический NPSSO, профиль по нику -> accountId, одна страница игр и трофеев); **NPSSO для профиля не нужен и не вводится**: NPSSO общий, технический, вставляется только owner (раздел 27) и не зависит от активного профиля. Строка создаётся только при результате `ok` (при ошибках проверки «полупрофилей» не остаётся); при `PSN_NEW_USER_MODE=friend` строка создаётся со статусом `friend_required` (перепроверка `PUT /api/me/psn`). Строка: `primary_user_id = loginId`, `email` = почта входа, `role = member`, `status = active`, `psn_*` из проверки. Тело запроса строгое: поля кроме `onlineId`/`activate` дают `400 invalid_request`. Вход сессии не `active` -> `401`. `MULTIUSER_ENABLED` для привязки профиля не требуется (режим «Доступа» к приглашениям, а не к профилям). Ответ `201 { profile, activeProfileId }` (+ `Set-Cookie`, если `activate`). Если у этого входа есть архивный профиль с тем же аккаунтом PSN, он восстанавливается (`200 { profile, restored: true }`, данные на месте). `onboarded_at` дополнительного профиля ставится сразу при создании и при восстановлении из архива, если проверка дала `ok` (ник проверен при добавлении; иначе guard по роли входа из cookie уводил бы member на `/onboarding`, QA-41-1); при `friend_required` остаётся NULL, дальше как в Фазе 20 (первый успешный синк). Основной профиль проходит онбординг как прежде.
Ошибки: `409 profile_limit` (на вход не больше `MAX_PROFILES_PER_LOGIN`, по умолчанию 3, считаются `active`, основной входит в счёт; `details.limit`), `409 user_limit` (`MAX_USERS` теперь считает все профили `invited+active`), `409 psn_id_taken` (ник/аккаунт уже в другом активном профиле, в том числе другого входа или `PSN_TARGET_ONLINE_ID` не-владельцем), `422 psn_not_found`, `422 psn_private`, `429 rate_limited` (не чаще раза в 30 с на вход, `Retry-After`; реализация без новых таблиц: `created_at` последнего доп. профиля входа в БД + счётчик в памяти процесса для неуспешных попыток, то есть для отказов PSN защита best-effort между инстансами; нагрузку на PSN дополнительно сдерживает общий лимит техаккаунта), `503 psn_unavailable`, `500 config_error`, `503 db_unavailable`, `400 invalid_request`.

`DELETE /api/me/profiles/{id}` `{ confirmOnlineId: string, purge?: boolean }` — отвязка. По умолчанию **архив**: `status = 'archived'`, `archived_at = now()`; данные, игры, трофеи, статусы остаются нетронутыми, профиль исчезает отовсюду (переключатель, cron, digest, копии, «Доступ») и освобождает слот и аккаунт PSN (индексы 41.1 игнорируют архив). Хранится 30 дней, затем watchdog удаляет строку (каскад) физически; восстановление: `POST /api/me/profiles` с тем же ником, пока архив не чужой аккаунт-конфликт (иначе `409 psn_id_taken`). `purge: true` — немедленное безвозвратное удаление каскадом (допустимо и для архивных). 200 `{ archived: true | purged: true, activeProfileId }`; если удалён активный, `activeProfileId` = основной и приходит новая `Set-Cookie`. Ошибки: `404 not_found` (чужой/несуществующий), `409 primary_protected` (основной профиль отвязать нельзя; «сделать основным» вне Фазы 41, вход целиком удаляет owner через «Доступ»), `409 sync_in_progress` (у профиля идёт `sync_runs.running`), `400 confirm_mismatch` (ник без учёта регистра), `400 invalid_request`.

`PUT /api/me/psn`, `GET /api/me/psn`, `POST /api/sync`, `GET /api/sync/status`, `/api/health` и все остальные роуты работают с активным профилем без изменений. Смена ника у профиля: правило `psn_account_locked` (22.13) остаётся (другой аккаунт PSN = другой профиль).

«Доступ» (22.5): `GET /api/access/users` отдаёт строки не-архивных профилей с новыми полями `loginId`, `isPrimary`, `profilesCount` (на основной); `PATCH` (блокировка/разблокировка) и `DELETE` применяются ко ВСЕМУ входу (id любой его строки приводится к основному), `confirmEmail` сверяется с почтой входа; `psnAccessMode` меняет только указанную строку. `AccessUser` (раздел 22.5) дополняется полями `loginId` (id основного), `isPrimary`, `profilesCount` (на основной: число не-архивных профилей входа, включая основной; у дополнительной строки 0). Блокировка/разблокировка по id дополнительной строки применяется ко всему входу; разблокировка проверяет `MAX_USERS` на все возвращаемые строки входа (`user_limit`). `DELETE` по id дополнительной строки удаляет весь вход. `POST /api/access/users` создаёт только основной профиль; `409 user_exists` проверяет по основным строкам.

Для frontend: после переключения/добавления/удаления сделать полную перезагрузку данных (навигация или `router.refresh()` и сброс клиентских кэшей); ключи localStorage с пользовательскими настройками (фильтры, сортировки) включают `activeProfileId`. HTTP-кэш только с обязательной сверкой (`no-store` или `private, no-cache` + ETag, раздел 3.4): сервер всегда отвечает данными текущего профиля; клиентский кэш GET (30 с, `src/ui/data/http.ts`) сбрасывается при смене профиля.

### 41.4 Синк и cron

- Обход (22.13) не меняется по алгоритму: подходящий профиль = `status = 'active'`, `psn_access_status = 'ok'`, есть ник, **и основная строка входа `active`**; порядок `id`, строго вперёд, глобальный «один `running`». Дополнительные профили попадают в обход сами. `continue` проверяет и профиль, и вход (`user_inactive`).
- Лимит функции Vercel от числа профилей не зависит: каждый профиль идёт своими звеньями по `SYNC_TIME_BUDGET_MS`, профили строго по одному. Растёт суммарная длительность ночной цепочки (≈ сумма по профилям) и число обращений к PSN под одним техническим токеном (параллели нет, rate-limit PSN не усиливается скачком). Страховки: потолок `MAX_USERS` (по умолчанию 10 профилей) и `MAX_PROFILES_PER_LOGIN` (3); сбой профиля обход не останавливает (22.13); недошедший профиль виден по `sync_missed:<id>` (watchdog). Новый профиль первый (тяжёлый) синк делает вручную днём, не ночью: онбординг ведёт на «Синхронизировать». Ручной синк при чужом идущем даёт `409 sync_in_progress` (чаще при N профилей, UI показывает «подожди»). QA замеряет длительность ночной цепочки на ≥5 профилях и фиксирует в отчёте.
- Лимиты RAWG/HLTB/LLM — на профиль (`user_id`, Фаза 20/раздел 24) без изменений. Следствие: вход с 3 профилями получает до 3× суточных квот; сверху остаются `LLM_DAILY_LIMIT` и потолки 41.3. Принято.
- Watchdog: `sync_missed`/`sync_stale` по каждому подходящему профилю (`:<id>` у всех, кроме owner id 1), подпись «Пользователь: <ник>.» (формулировка 22.13 сохранена, тексты и тесты не меняются); дополнительно удаляет архивные строки старше 30 дней (`DELETE ... WHERE status='archived' AND archived_at < now() - interval '30 days'`), число удалённых в ответе `archivePurged`. Еженедельная копия — по файлу на активный профиль (`backup_weekly:<id>`), владельцу в чат алертов, подпись с ником.
- Telegram (минимально безопасно, новых настроек нет): сводка собирается ТОЛЬКО по основным профилям (`primary_user_id IS NULL`), дополнительные в `digest.results` не попадают; данные в сводке только основного профиля. Получатели как F29.3. `/api/me/telegram*` всегда работают с основным профилем входа (`loginId`), независимо от активного; в `GET /api/me/telegram` добавляется `profile: { id, onlineId }` (о каком профиле сводка). Отдельный чат на профиль не закладывается.
- Лимит попыток входа, `psn_auth`, `psn_token_events`, `recommend_llm_state` глобальные и от профилей не зависят.

### 41.5 Миграция 0025 и выкладка

`src/db/migrations/0025_psn_profiles.sql`: DDL из 41.1, **бэкфилл не нужен**: все существующие строки автоматически основные (`primary_user_id` NULL по умолчанию; в проде 3 пользователя, 1237 игр, данные не трогаются). Никакие таблицы с данными не затрагиваются. Миграция в одной транзакции.

`docs/release-neon-0025.sql` (Артём применяет сам в Neon SQL Editor): идемпотентный (проверка `information_schema`/`pg_indexes`/`pg_constraint`, `IF NOT EXISTS`/`IF EXISTS`), в начале `RAISE EXCEPTION`, если есть дубли `psn_account_id` / `lower(psn_online_id)` или owner не `id = 1`; в конце запись в журнал `drizzle.__drizzle_migrations` (по образцу 0024, без дублей) и три boolean-флага «колонки/индексы/журнал на месте».
`docs/release-neon-0025-check.sql` («до» и «после»): `count(*)` по `allowed_users`, `games`, `trophies`, `playtime_snapshots`, `game_status` равны до и после; `count(*) where primary_user_id is not null` = 0; нет вложенных профилей; нет дублей PSN среди не-архивных; индексы на месте.
`docs/release-neon-0025-rollback.sql`: останавливается без изменений, если есть строки с `primary_user_id IS NOT NULL` (сначала удалить/перенести дополнительные профили), иначе возвращает прежний `allowed_users_email_key`, прежний CHECK статусов, убирает новые индексы/колонки и запись журнала.
Тест `src/db/release-sql-0025.test.ts` (PGlite, по образцу 0024): цепочка 0000..0024 + сидинг 3 пользователей с играми -> release-SQL дважды (идемпотентность) -> данные и счётчики без изменений, журнал без дублей; ограничения работают: два основных с одной почтой нельзя, дополнительный с копией почты можно, owner как дополнительный нельзя, вложенность ловит проверка из `check.sql`, дубль `psn_account_id`/ника нельзя, архивный профиль не блокирует тот же аккаунт, `archived_at` согласован со `status`, каскад удаляет данные профиля, а не соседнего; rollback отказывает при наличии дополнительных профилей.

Порядок: ветка Neon `before-0025` -> `check` («до») -> `release-neon-0025.sql` -> `check` («после») -> деплой кода. Миграция строго ДО кода (новый код на старой схеме падает), старый код на новой схеме работает (не знает `primary_user_id`, статус `archived` не использует). Откат кода: деплой предыдущей версии; если уже созданы дополнительные профили, старый код видит их как обычных `member` (их обойдёт cron, они попадут в «Доступ»), поэтому перед откатом профили архивируют/удаляют. Новое окружение (добавлено в `.env.example`): `MAX_PROFILES_PER_LOGIN` (необязательно, 1..5, по умолчанию 3).

### 41.6 Угрозы и тесты

| Угроза | Защита | Тест |
|---|---|---|
| Подмена `pid` на профиль другого входа | подпись + проверка `coalesce(p.primary_user_id,p.id) = uid` на каждом запросе | `session-profiles.test.ts`: валидно подписанный токен с чужим `pid` -> `401`, cookie очищена |
| Переключение на чужой/архивный/несуществующий профиль | `404 not_found` без различия причин | `src/app/api/me/profiles/*.test.ts` |
| IDOR при `DELETE /api/me/profiles/{id}`, добавление к чужому входу | `loginId` только из сессии, `where primary_user_id = loginId or id = loginId` | то же, два входа |
| Данные соседнего профиля того же входа (коллекция, трофеи, План, статусы, копия, Wrapped) | `userId` = активный профиль везде, как в Фазе 20 | `profile-isolation.test.ts` (по образцу `user-isolation.test.ts`: два профиля одного входа + третий чужого; все GET-роуты и выгрузка/восстановление копии видят только активный; восстановление копии применяется только к активному) |
| Вход по почте открывает не тот профиль/дополнительную строку | поиск только по основным строкам | `users.test.ts`: `lookupForLogin` при наличии дубля почты в дополнительной строке |
| Блокировка входа не касается дополнительных профилей; сессия с `pid` живёт после блокировки | блокировка ставит `blocked` на все строки; `requireUser` проверяет основную строку | тест: после PATCH `blocked` сессия с `pid` = `401`, cron не берёт ни одну строку |
| Эскалация роли (дополнительный профиль с `owner`, `google_sub` у дополнительного) | CHECK 41.1 и один owner | `release-sql-0025.test.ts` |
| Один аккаунт PSN в двух профилях/входах | unique-индексы 41.1 + `psn_id_taken` | гонка двух `POST /api/me/profiles` с одним ником: один успех |
| Обход лимитов профилей параллельными запросами | advisory lock 7204002 | тест параллельных `POST` |
| Удалённый/архивный профиль продолжает синкаться | `status = 'active'` во всех выборках cron, digest, backup | `qa-phase-41.test.ts`: архивный не в обходе, не в digest, не в копиях |
| Telegram-привязка к дополнительному профилю, сводка по чужому профилю | `/api/me/telegram*` и digest только по основному | тест: при активном дополнительном привязка пишется на основной; digest не содержит дополнительных |
| Старые данные в клиентском кэше после переключения | полная перезагрузка (41.3), `no-store` | e2e: переключить профиль, коллекция/трофеи другие, чужих игр нет |
| Продление сессии переключением | тот же `iat`/`exp` | `session-profiles.test.ts` |
| CSRF на переключение/добавление | Origin + `application/json` + `SameSite=Lax` | тесты роутов |

Статический охранный тест `user-scope.test.ts` дополняется: выборки `allowed_users` по email/`google_sub` обязаны содержать `primary_user_id`. Каждый новый `route.ts` под `blocked.test.ts` (без сессии 401). Playwright: вход -> добавить второй профиль -> переключиться -> в шапке другой ник, коллекции разные -> удалить (архив) -> вернулись на основной.

### 41.7 Открытые вопросы к Артёму

1. Чьи аккаунты? Принадлежность аккаунта PSN проверить нельзя (чтение идёт по открытому профилю через технический NPSSO, входа через PSN нет), как и в Фазе 20. Рекомендация: разрешить любой открытый профиль, правило «только свои» держится на доверии, защита от захвата чужого ника — уникальность аккаунта и `psn_id_taken`. Блокирует формулировку подсказки в UI.
2. Можно принять по умолчанию без ответа: лимит 3 профиля на вход, `MAX_USERS` считает профили (10); архив 30 дней перед физическим удалением; «сделать основным» и «запомнить последний профиль» не делаем (если друг захочет убрать основной, owner пересоздаёт вход).

## Фаза 35. Страница «Здоровье» (owner), без миграции

Одна owner-only ручка, которая собирает состояние сервиса по всем профилям. Новых таблиц и колонок нет: читаются `allowed_users`, `sync_runs`, `provider_usage`, `recommend_llm_usage`, `psn_token_events`, env. К PSN ручка не обращается. Логика в `src/server/health/` (чистые функции `limits.ts`, `criteria.ts` + загрузчик `overview.ts`), роут `src/app/api/health/overview/route.ts`. Существующий `GET /api/health` (4.3) не меняется.

### F35.1 `GET /api/health/overview`

Доступ: `requireOwner` (роль входа из БД). Без сессии `401 unauthorized`; member (и дополнительный профиль member-входа) `403 forbidden`, тело не содержит данных; БД недоступна `503 db_unavailable`. Ответ `Cache-Control: no-store`. Параметров нет.

```json
{ "ok": true, "data": {
  "generatedAt": "2026-11-01T10:00:00.000Z",
  "day": "2026-11-01",
  "multiuser": { "enabled": false, "maxUsers": 10, "activeProfiles": 1 },
  "limits": {
    "rawg": { "state": "active", "userLimit": 60, "totalLimit": 300, "userSource": "default", "totalSource": "default", "keyConfigured": true },
    "hltb": { "state": "active", "userLimit": 300, "totalLimit": 1000, "userSource": "env", "totalSource": "default" },
    "llm":  { "state": "disabled", "reason": "no_key", "userLimit": 12, "totalLimit": 60, "userSource": "default", "totalSource": "default", "provider": "groq" }
  },
  "psnToken": { "issuedAt": "...", "ageSeconds": 864000, "source": "pasted", "lastEvent": { "event": "refreshed", "at": "...", "details": { "refreshTokenExpiresInSec": 864000 } } },
  "users": [ {
    "id": 1, "loginId": 1, "isPrimary": true, "role": "owner", "status": "active",
    "label": "Target", "email": "owner@example.com", "psnOnlineId": "Target",
    "psnAccessStatus": "ok", "psnAccessCheckedAt": "...", "onboardedAt": "...", "lastLoginAt": "...",
    "sync": {
      "lastSuccessAt": "...", "lastAttemptAt": "...",
      "recentErrors": [ { "id": 41, "kind": "daily", "status": "failed", "errorReason": "auth_expired", "startedAt": "..." } ]
    },
    "usage": { "rawg": { "used": 3, "limit": 60 }, "hltb": { "used": 0, "limit": 300 }, "llm": { "used": 2, "limit": null } }
  } ],
  "totals": { "rawg": { "used": 3, "limit": 300 }, "hltb": { "used": 0, "limit": 1000 }, "llm": { "used": 2, "limit": null } },
  "criteria": {
    "summary": { "pass": 2, "fail": 1, "pending": 1, "manual": 2 },
    "items": [ { "id": "owner_ready", "title": "...", "status": "pass", "detail": "..." } ]
  }
} }
```

**Поля.**
- `users`: все строки `allowed_users` кроме `archived`, по `id`. Дополнительные профили (`primary_user_id != null`) идут отдельными строками: `isPrimary = false`, `loginId` = id основного, `email = null` и `lastLoginAt = null` (вход принадлежит основной строке, см. 41.1). Email отдаётся только у основных строк (владелец и так видит их в `/api/access/users`); `googleSub`, `psnAccountId`, имя из Google, токены, `invitedBy` не отдаются. `label` = `displayName` или `psnOnlineId` или `null`.
- `sync` (по `user_id` профиля, `kind = 'hltb'` исключён, как в 4.3/16.7): `lastSuccessAt` = `finished_at` последнего `status = 'success'`; `lastAttemptAt` = `started_at` последнего запуска, кроме отменённых; `recentErrors` = до 5 запусков `failed|partial` за последние 14 суток (кроме `error_reason = 'cancelled'`), новые первыми. Только `id, kind, status, errorReason, startedAt`: `error_message` и `warnings` не отдаются (там может быть текст PSN). Запусков нет: `null` и `[]`.
- `usage`: расход за сутки МСК (`day`): RAWG/HLTB из `provider_usage`, LLM из `recommend_llm_usage.calls`. `limit` = потолок на профиль (`userLimit`) или `null`, если провайдер выключен (см. ниже). Отсутствие строки = `used: 0`.
- `totals`: сумма `used` по всем профилям за сутки (включая архивные, они делят общий потолок) и общий потолок (`totalLimit`) или `null`.
- `psnToken`: как в 27.4 (глобальный, один технический аккаунт), `null` если журнала нет. Возраст = `ageSeconds` с последнего `pasted|from_env`. Ориентир: refresh-токен живёт ~10 дней (CLAUDE.md), срок NPSSO не измерен; порогов и цветов ручка не решает, это дело UI.

**Потолки не молчат про «ноль» (`limits.*`).** Объект явно говорит, включён ли провайдер:
- `state`: `active | disabled`. `disabled` значит «запросы не выполняются», а не «без лимита»; безлимитного режима в проекте нет. Тогда `userLimit`/`totalLimit` остаются эффективными значениями, а `usage[].limit` и `totals.limit` = `null`.
- RAWG: `disabled` при отсутствии `RAWG_API_KEY` (`reason: 'no_key'`) или `RAWG_DAILY_LIMIT=0` (`reason: 'limit_zero'`). HLTB: `disabled` при `HLTB_DAILY_LIMIT=0`. LLM: `disabled` при нет провайдера/ключа (`reason: 'no_provider'`, если `LLM_PROVIDER` не `gemini|groq` (проверяется первым, в том числе когда нет и ключа); `'no_key'`, если провайдер задан, а `LLM_API_KEY` пуст) или `LLM_DAILY_LIMIT=0` (`'limit_zero'`). `provider` у LLM = `gemini|groq|null`; ключ и модель не отдаются.
- `userSource`/`totalSource`: `default` (переменная не задана или не число), `env` (значение принято как есть), `clamped` (значение вне допустимого диапазона приведено к границе; например `RAWG_USER_DAILY_LIMIT=0` на самом деле даёт 1, так как нижняя граница 1). Эффективное число всегда в `userLimit`/`totalLimit`.

**Критерии для `MULTIUSER_ENABLED=1` (`criteria`).** Чеклист из `docs/qa/phase-20-5.md`. `status`: `pass` (вычислено, выполнено), `fail` (вычислено, нет), `pending` (вычисляется только после включения мультипользователя), `manual` (из данных не вычислить, отмечает человек). Значения env в `detail` не попадают (только факт «задано/нет» и числа).
| `id` | Что считается |
|---|---|
| `owner_ready` | пункт 1: владелец `role='owner'`, `status='active'`, `psn_access_status='ok'`, `psn_online_id` равен `PSN_TARGET_ONLINE_ID` без учёта регистра. `fail` с перечнем невыполненного, если нет |
| `env_sync_origin` | пункт 2: `SYNC_ORIGIN` задан (именно явный, не `VERCEL_URL`; B-1) |
| `env_cron_secret` | пункт 2: `CRON_SECRET` задан |
| `env_llm_budget` | пункт 2: `LLM_DAILY_LIMIT >= активные_профили x LLM_USER_DAILY_LIMIT` (как `llmLimitWarning`). LLM выключен: `pass` с пометкой в `detail` (шаблоны, кормить нечем) |
| `second_account_live` | пункт 3: `manual` |
| `observation_sync` | пункт 4: если `multiuser.enabled = false` -> `pending`; иначе `pass`, когда у каждого активного профиля с ником есть `success` не старше 36 часов, иначе `fail` с числом отставших |
| `observation_watchdog` | пункт 4: ложные алерты watchdog и ночные сутки наблюдения: `manual` |
| `block_delete_member` | пункт 5: `manual` |
| `ci_green` | пункт 6: `tsc`, `eslint`, `vitest`, e2e: `manual` (проверяет CI/QA) |
`multiuser.enabled` = `MULTIUSER_ENABLED=1`; `activeProfiles` = число строк `status in ('invited','active')`.

### F35.2 Ошибки
| Код | HTTP | Когда |
|---|---|---|
| `unauthorized` | 401 | нет/невалидная сессия |
| `forbidden` | 403 | роль входа не owner |
| `db_unavailable` | 503 | БД недоступна |
Частичный отказ источника (нет таблицы `psn_token_events` до 0019 и т.п.): соответствующий блок `null`/пустой, ответ остаётся 200.

### F35.3 Безопасность и тесты
- Секреты (NPSSO, access/refresh, `CRON_SECRET`, `LLM_API_KEY`, `RAWG_API_KEY`, сессия) в ответ не попадают ни в каком виде, `details` токенных событий отдаются как есть (в журнале 27.3 там только числа и причины).
- Тесты: `src/server/health/*.test.ts` (чистая логика: потолки, критерии, возраст), `src/app/api/health/overview/route.test.ts` (PGlite: 401, 403 member и дополнительного профиля member-входа, нет секретов и `google_sub`/`psn_account_id`/`error_message` в теле, данные всех профилей только для owner). Роут автоматически под `blocked.test.ts` (без сессии 401).

## Фаза 43. Бэклог: игры «не куплено» из магазина PS (миграция 0026)

Пользователь ищет игру в RAWG (только PS5/PS4) и добавляет её в Бэклог: статус всегда `backlog`, пометка «не куплено» обязательна. Пометка снимается вручную («Купил») или синком, когда в библиотеке PSN появилась совпавшая игра, в которую играли. Все роуты: сессия `requireUser`, `user_id` = активный профиль (Фаза 41), запись требует Origin и (где есть тело) `Content-Type: application/json`; общие ошибки `401 unauthorized`, `400 invalid_request`, `503 db_unavailable` (без текста исключения). Запись чужого профиля или входа неотличима от несуществующей (`404 not_found` / `removed: false`).

### 43.1 Схема (миграция `0026_manual_games`, только добавляет таблицу)
```
manual_games
  id                  integer PK identity
  user_id             integer NOT NULL  FK allowed_users(id) ON DELETE CASCADE
  rawg_id             text    NOT NULL                      -- ключ внешней игры
  title               text    NOT NULL  CHECK 1..200
  cover_url           text    NULL
  release_date        date    NULL
  kind                text    NOT NULL  CHECK in ('ps_backlog','other_platform')   -- other_platform: Фаза 44
  not_purchased       boolean NOT NULL DEFAULT false        -- CHECK: true только при kind = 'ps_backlog'
  linked_game_id      integer NULL      FK (user_id, linked_game_id) -> games(user_id, id) ON DELETE CASCADE
  suggested_game_id   integer NULL      FK (user_id, suggested_game_id) -> games(user_id, id) ON DELETE CASCADE   -- вопрос «Это та игра?»
  rejected_game_ids   integer[] NOT NULL DEFAULT '{}'       -- пары (rawg_id <-> игра), на которые ответили «Нет»
  platform_label      text    NULL      CHECK 1..60         -- Фаза 44, подпись платформы
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
  UNIQUE (user_id, rawg_id, kind)
  CHECK manual_games_linked_check: linked_game_id IS NULL OR (not_purchased = false AND suggested_game_id IS NULL)
  INDEX (user_id, kind); INDEX (user_id, suggested_game_id) WHERE suggested_game_id IS NOT NULL
```
Колонки `suggested_game_id` и `rejected_game_ids` добавлены сверх брифа (нужны для «Входящих» и запоминания «Нет», решение оркестратора 2). Запись `linked_game_id IS NOT NULL` остаётся в таблице (защита от повторного предложения), но в Бэклоге отдельно не показывается. Миграцию на прод применяет Артём: `docs/release-neon-0026.sql` (идемпотентный, журнал drizzle), `docs/release-neon-0026-check.sql`, тест `src/db/release-sql-0026.test.ts`. Новый код на старой схеме: роуты `manual-games` отвечают `503`, шаг синка даёт предупреждение `manual_match_failed`, «У тебя нет», План и Входящие работают.

Игры «не куплено» живут ТОЛЬКО в `manual_games`, не в `games`/`game_status`. Поэтому Статистика, Итоги, часы, прогноз платины, «Подскажи» (скоринг бэклога библиотеки) их не видят по построению; `rawg_id` записей исключается из «У тебя нет» и из поиска/«Скоро» в План (`ownedRawgIds`/`filterOwned`, как отметки Фазы 40).

### 43.2 Роуты

Тип записи Бэклога:
```
ManualGame = {
  id: number;                     // id записи manual_games (НЕ games.id: пространства id разные)
  source: 'manual'; kind: 'ps_backlog';
  externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null;
  releaseDate: string | null;     // YYYY-MM-DD
  status: 'backlog';              // всегда
  notPurchased: boolean;          // true после добавления; false после «Купил»
  matchSuggestion: { gameId: number; name: string; imageUrl: string | null } | null;   // ждёт ответа «Это та игра?»
  createdAt: string; updatedAt: string   // ISO
}
```

`GET /api/manual-games[?nb=1]` — записи Бэклога, несклеенные с библиотекой, новые сверху (`createdAt` убыв., `id` убыв.). `nb=1` («Не куплено») оставляет только `notPurchased = true`; `nb` отсутствует или `0` = все; другое значение = 400. `/api/games` и список библиотеки не меняются (игры библиотеки никогда не «не куплено»): при `nb=1` фронт показывает только этот список. `200 { items: ManualGame[] }`.

`POST /api/manual-games` — «В бэклог». Тело (строгое, лишние поля = 400):
`{ "externalSource": "rawg", "externalId": "3328", "title": "...", "coverUrl": "https://..." | null, "releaseDate": "YYYY-MM-DD" | null, "confirmDuplicate"?: boolean }`.
- Запись уже есть (несклеенная): `200 { item, created: false }` без изменений (идемпотентно).
- Дубль с игрой библиотеки (совпал RAWG id через `owned_marks`/прежнюю склейку или нормализованное название `libraryKey`) или с активным пунктом Плана (`planned_games.status in ('planned','done')`, по RAWG id или названию), без `confirmDuplicate: true`: `409 duplicate_game`, `details: { duplicate: 'library' | 'planned', game: {gameId, name, imageUrl} | null, planned: {id, title, status} | null }`. Клиент показывает предупреждение и по явному подтверждению повторяет запрос с `confirmDuplicate: true`. Если запись была склеена с библиотекой раньше и добавляется повторно с подтверждением, она снова становится «не куплено».
- Успех: `200 { item: ManualGame, created: true }`; `notPurchased: true`, `status: 'backlog'`.
- Лимит: 200 несклеенных записей, дальше `409 manual_limit`.

`POST /api/manual-games/{id}/purchased` — «Купил»: `notPurchased = false`. Идемпотентно. Запись остаётся в Бэклоге без данных PSN (мета «Ждём первый запуск») до склейки с игрой библиотеки. `200 { item }`; `404 not_found` (чужая, несуществующая, уже склеенная).
`DELETE /api/manual-games/{id}/purchased` — «Отменить» снятие пометки: `notPurchased = true`. Идемпотентно, те же ошибки. `200 { item }`.

`DELETE /api/manual-games/{id}` — удалить запись. Идемпотентно. `200 { id, removed: boolean }`.

`PUT /api/manual-games/{id}/status` — НЕ меняет ничего: у несклеенной записи статус всегда `backlog`. `409 manual_status_locked` для своей несклеенной записи, `404 not_found` иначе. Окна игры и смены статуса для таких записей у frontend нет (у записи нет `gameId`). Склеенная запись становится обычной игрой библиотеки (`/api/games/{id}/status`).

### 43.3 Поиск
`GET /api/manual-games/search?q=hades` — `q` 2..80 символов после trim (иначе 400). Поиск по нажатию (запрос уходит только по действию пользователя; автопоиска на каждый символ нет). RAWG с `platforms=187,18` (PS5/PS4), ответ дополнительно фильтруется `playstation = true`. Кэш процесса 10 мин по ключу «запрос без регистра и лишних пробелов» (ключ API не входит): попадание не тратит лимит и не пишется в `provider_usage`. Реальный запрос резервирует вызов `provider_usage` (`rawg`, лимит на профиль, `RAWG_USER_DAILY_LIMIT` и общий потолок, как у остальных вызовов RAWG).
`200 { candidates: (CatalogCandidate & { duplicate: 'library' | 'planned' | null; inBacklog: boolean })[], cached: boolean }`. `CatalogCandidate` как в 17.9 (`externalSource, externalId, title, releaseDate, coverUrl, platforms, playstation`). Кандидаты, уже лежащие в Бэклоге, не скрываются, а помечаются `inBacklog: true`.
Ошибки: `503 catalog_unavailable` с `details.reason` (`no_key | timeout | network | http_error | rate_limited | bad_response`); при `rate_limited` в `details.resetAt` ISO начала следующих суток МСК, когда лимит обнулится. БД недоступна: поиск работает, `duplicate = null`, `inBacklog = false` (POST проверит дубль ещё раз).

### 43.4 Что исключается
- Статистика, Итоги (Wrapped), часы, прогноз платины, «Подскажи», План (в него записи не попадают сами): их выборки идут по `games`/`game_status`, `manual_games` туда не входит; тест сравнивает `getStats` до и после добавления записей.
- «У тебя нет», поиск и «Скоро» в Плане: фильтр по RAWG id записей (любой `kind`, любое состояние), на чтении, как отметки Фазы 40 (см. 40.3).
- Резервная копия разметки статусов записи не содержит.

### 43.5 Склейка с библиотекой: шаг синка и «Это та игра?»
Шаг `manualMatchStep` (`src/server/sync/manual-match-step.ts`) идёт в конце успешного звена после склейки дублей (Фаза 23), без сети, батчами по 50 записей с проверкой бюджета времени, ошибка = предупреждение `manual_match_failed`, итог синка не меняется. Обрабатывает все несклеенные записи `ps_backlog` (и «не куплено», и уже «Купил»). Игры библиотеки берутся группами «главная игра + дубли», скрытые игнорируются; «играли» = у любой игры группы `last_played_at IS NOT NULL` или `play_duration_seconds > 0`.
- Уверенное совпадение: (а) RAWG id записи есть в `owned_marks` как `covered` игрой библиотеки; (б) `libraryKey(title)` записи равен ключу названия ровно одной группы. Если группа играна: `linked_game_id = главная игра`, `not_purchased = false`, `suggested_game_id = NULL`; игре без своего статуса ставится `backlog` (`status_changed_at` = момент добавления записи в Бэклог, чтобы подсказка «Начал играть» сработала на более поздний запуск); уже стоящий статус не меняется. Ручных полей у записи нет, переносить больше нечего. Запись из `GET /api/manual-games` исчезает (без дубля).
- Неуверенное совпадение (несколько групп с одним ключом: берётся играннее; название одной целиком входит в другую цепочкой слов: «Hades» и «Hades II», не короче 4 символов): ничего не склеивается, пишется `suggested_game_id`, запись получает `matchSuggestion`, во «Входящих» появляется вопрос. Совпавшая, но неиграная игра не даёт ни склейки, ни вопроса (пометка остаётся).
- Пары, на которые ответили «Нет» (`rejected_game_ids`), не предлагаются и не склеиваются автоматом никогда (в том числе по `owned_marks`).
- «Всё равно добавить» (`POST /api/manual-games` с `confirmDuplicate=true`) при дубле с игрой библиотеки (по ключу названия или `owned_marks`) записывает id главной игры этой группы в `rejected_game_ids` (также при повторном добавлении склеенной записи): синк такую пару не склеивает и не предлагает (QA-43-1). Дубль с Планом пары не создаёт.
- Если ключ названия записи точно совпал с игрой библиотеки (даже неиграной или отклонённой), слабые совпадения с другими играми («Hades» против «Hades II») не предлагаются: запись ждёт запуска точной пары (QA-43-2).
- Идемпотентность: повторный запуск без изменений данных ничего не пишет; предложение, ставшее неактуальным, сбрасывается в `NULL`.

`GET /api/manual-games/matches` — карточки «Это та игра?»: `200 { matches: { id: number; title: string; coverUrl: string | null; notPurchased: boolean; game: { gameId: number; name: string; imageUrl: string | null; lastPlayedAt: string | null; hours: number } }[] }`, старые записи первыми.
`POST /api/manual-games/{id}/match` — тело `{ "answer": "yes" | "no" }`. `yes`: склейка с предложенной игрой (id берётся из БД, не от клиента), как в уверенном совпадении; `200 { id, answer, linked: { gameId, name, imageUrl } }`. `no`: пара запоминается, вопрос исчезает, запись остаётся в Бэклоге; `200 { id, answer, linked: null }`. Нет вопроса по этой записи (в том числе уже отвечен, чужая запись): `404 not_found`.
Дополнение `GET /api/inbox` (F28.1): поле `matchCount: number | null` — число вопросов «Это та игра?». Вне `failed`/`partial` (сбой счёта даёт `null`, на схеме до 0026 тоже `null`); `isEmpty = false`, если `matchCount > 0`.

### 43.6 Тесты
`src/server/manual/manual.test.ts` (PGlite: чистое сопоставление, изоляция двух входов и профиля одного входа, уверенное и неуверенное совпадение, «Да»/«Нет», идемпотентность шага, ручное «Купил»/«Отменить», дубль с библиотекой и Планом, исключение из выдач, Статистика не меняется), `src/app/api/manual-games/routes.test.ts` (401, валидация, Origin, 409, resetAt, запрет статуса, 503 без утечек), `src/db/release-sql-0026.test.ts`, охранный `user-scope.test.ts` (`manualGames`).

## Фаза 43.1. «Не куплено»: доработки (без миграции)

Колонки и схема не меняются. Все роуты по правилам Фазы 43 (сессия, `user_id` активного профиля, Origin и `application/json` на записи, `503 db_unavailable` без текста исключения).

### 43.1.1 «Купил / Не купил» при добавлении
`POST /api/manual-games` принимает необязательное `notPurchased?: boolean` (по умолчанию `true`, поведение Фазы 43 не меняется). `false` = «Купил»: запись создаётся без пометки (`notPurchased: false`), статус `backlog`, в карточке мета «Ждём первый запуск»; шаг синка 43.5 склеивает её с игрой библиотеки по тем же правилам, что и «Купил» из меню. Не boolean = `400`. Идемпотентность прежняя: если несклеенная запись уже есть, `200 { item, created: false }` и флаг НЕ перезаписывается (переключение только через `/purchased`). Повторное добавление ранее склеенной записи с `confirmDuplicate` применяет переданный `notPurchased`.

### 43.1.2 Пакетное добавление
`POST /api/manual-games/batch`. Тело (строгое): `{ "items": Item[] }`, `1..10` элементов (иначе `400 invalid_request`), `Item` = тело `POST /api/manual-games` целиком (`externalSource, externalId, title, coverUrl, releaseDate, notPurchased?, confirmDuplicate?`; лишние поля = 400 на всю пачку). Невалидная пачка отклоняется целиком (`400`); всё остальное даёт частичный успех: каждый элемент обрабатывается независимо и в порядке массива, ошибка одного не откатывает остальные.

`200 { results: BatchResult[], created: number }`, `results[i]` соответствует `items[i]`:
```
BatchResult =
  | { index, externalId, status: 'created', item: ManualGame }
  | { index, externalId, status: 'exists',  item: ManualGame }            // несклеенная запись уже была (в т.ч. повтор внутри пачки или повтор всей пачки)
  | { index, externalId, status: 'duplicate', code: 'duplicate_game', details: { duplicate, game, planned } }   // как 409 у одиночного POST; повтор с confirmDuplicate: true
  | { index, externalId, status: 'error', code: 'manual_limit' | 'db_unavailable' }
```
Общий лимит 200 несклеенных записей на профиль действует поэлементно: когда место кончилось, новые элементы получают `error / manual_limit`, ранее созданные остаются; `exists` и `duplicate` лимитом не затрагиваются. Идемпотентно: повтор той же пачки даёт `exists` для уже созданных. Ошибка БД на одном элементе = `error / db_unavailable` для него (остальные продолжаются); если БД недоступна до начала, `503 db_unavailable`. Изоляция по `user_id`: пачка видит и пишет только записи активного профиля.

### 43.1.3 Подсказки при вводе (typeahead)
`GET /api/manual-games/search?q=&mode=suggest`. `mode` — только `suggest` (иное значение = 400); без `mode` поиск по Enter работает как в 43.3 (`q` 2..80). В режиме `suggest` `q` 3..80 символов после trim (иначе `400`). Тот же формат ответа `200 { candidates, cached }` (`duplicate`, `inBacklog` расставлены), но `candidates.length <= 8` (`page_size = 8` у RAWG).

Кэш подсказок (процесс, TTL 10 мин, отдельный от кэша Enter-поиска, ключ = запрос без регистра и лишних пробелов):
- точное попадание по ключу;
- префиксное: если закэширован более короткий префикс (>= 3 символа, `q` начинается с него), его выдача ПОЛНАЯ (RAWG вернул меньше 8, т.е. обрезки не было) и фильтр по токенам `q` (каждый токен — подстрока нормализованного названия) оставляет выдачу, то ответ строится локально. Если закэшированная выдача была обрезана (ровно 8), локальный вывод невозможен и идёт запрос. Нечёткие совпадения RAWG (опечатки) при локальной фильтрации могут отсутствовать, Enter-поиск их по-прежнему даёт.
Попадание в кэш (`cached: true`) не тратит лимит и не пишется в `provider_usage`.

Мягкий дневной предел подсказок на профиль (счётчик подсказок в памяти процесса + проверка `provider_usage`; новой колонки/провайдера нет, CHECK `provider_usage_provider_check` не трогаем). Реальный запрос подсказки занимает вызов `rawg` в `provider_usage` как любой другой (общий потолок и лимит на профиль действуют), но сначала проверяется:
- собственных подсказок за сутки МСК не больше `RAWG_SUGGEST_DAILY_LIMIT` (по умолчанию 30, не больше половины `RAWG_USER_DAILY_LIMIT`; `0` = подсказки выключены);
- израсходовано `rawg` за сутки меньше 80% `RAWG_USER_DAILY_LIMIT` (20% остаются для «У тебя нет», Плана и поиска по Enter).
При превышении любого: `429 rate_limited`, `details: { reason: 'suggest_limited', resetAt }` (resetAt — начало следующих суток МСК). Запрос к RAWG не уходит, лимит не списывается. Клиент: прекращает автоподсказки до `resetAt` и продолжает искать по Enter (он этим пределом не ограничен).
Жёсткая квота RAWG (лимит `provider_usage` на профиль/общий или 429 самого RAWG) в режиме `suggest`: `429 rate_limited`, `details: { reason: 'quota', resetAt }`. Клиент прекращает и подсказки, и Enter-поиск до `resetAt` (Enter получит тот же отказ: `503 catalog_unavailable`, `details.reason='rate_limited'`, как в 43.3). Прочие сбои RAWG в `suggest` — как в 43.3 (`503 catalog_unavailable`, `details.reason`). Подсказка из popup добавляется обычным `POST /api/manual-games` с `notPurchased` по умолчанию (`true`); «Купил» и мультидобавление — через `/batch`.

Отмена на клиенте: запрос чтения без побочных эффектов, кроме прогрева кэша и списания лимита уже дошедшего до RAWG вызова. Клиент отменяет устаревшие запросы `AbortController` и дебаунсит ввод; повтор идемпотентен.

### 43.1.4 Поиск в Бэклоге («Из списка»)
Новых параметров нет. `GET /api/manual-games` не постраничный (до 200 несклеенных записей, весь список в одном ответе): клиент фильтрует его локально (подстрока по названию без регистра). Игры библиотеки в Бэклоге идут через `GET /api/games` (постраничный, `limit/offset`), где параметр `q` уже есть (Фаза 6): блок «Из списка» берёт `status=backlog&q=` оттуда. Секция «Не куплено» строится на клиенте из `GET /api/manual-games` (`nb=1` или фильтр по `notPurchased`). Склеенные записи в `manual-games` не приходят, дублей нет.

### 43.1.5 Тесты
`src/server/manual/manual-43-1.test.ts` (PGlite: `notPurchased=false`, пакет: частичный успех, дубли, лимиты 10 и 200, идемпотентность, изоляция; подсказки: точный и префиксный кэш, мягкий предел, общий лимит не ломается), `src/app/api/manual-games/batch-suggest.routes.test.ts` (400, 401, 429 с `resetAt`, `page_size`).

## Фаза 44. «Играл на другой платформе» (без миграции)

Ручной справочник игр, пройденных вне PSN (Xbox, Steam, Nintendo и др.): `manual_games.kind = 'other_platform'`, таблица и колонка `platform_label` из миграции 0026. Новых таблиц и колонок нет. Роуты 43 расширены, новых нет; сессия `requireUser`, `user_id` = активный профиль (Фаза 41); запись требует Origin и `Content-Type: application/json`; общие ошибки `401`, `400 invalid_request`, `503 db_unavailable`. Чужая запись (другой вход или другой профиль того же входа) неотличима от несуществующей.

### 44.1 Правила записи
- `not_purchased = false` всегда (CHECK `manual_games_not_purchased_check`: true допустим только для `ps_backlog`; поле в теле запрещено). Ни статуса, ни часов, ни трофеев, ни дат прохождения у записи нет.
- Запись НЕ попадает в `games`/`game_status`: Статистика, Итоги, Бэклог (список, счётчик, «Не куплено»), План, прогнозы, часы не видят её по построению. Склейка с библиотекой (шаг синка 43.5), «Это та игра?», «Купил», смена статуса работают только с `ps_backlog`; для id записи `other_platform` эти роуты отвечают `404 not_found`.
- `GET /api/manual-games` без `kind` возвращает ТОЛЬКО `ps_backlog`.
- Уникальность `(user_id, rawg_id, kind)`: игра может лежать и в Бэклоге, и в этом списке; записи независимы.
- Лимит: 300 записей `other_platform` на профиль (отдельно от 200 «не куплено»).

### 44.2 Роуты
Тип записи:
```
OtherPlatformGame = {
  id: number; source: 'manual'; kind: 'other_platform';
  externalSource: 'rawg'; externalId: string; title: string;
  coverUrl: string | null; releaseDate: string | null;   // YYYY-MM-DD
  platformLabel: string | null;   // подпись «на чём играл», только текст
  createdAt: string               // ISO
}
```
`GET /api/manual-games?kind=other_platform` — `200 { items: OtherPlatformGame[] }`, `createdAt` убыв., `id` убыв., только свой профиль. `kind` отсутствует или `ps_backlog` = Бэклог (43.2); другое значение = 400. `nb` для `other_platform` игнорируется.

`POST /api/manual-games` с `kind: 'other_platform'` — тело (строгое, лишние поля, включая `notPurchased`, = 400):
`{ "kind": "other_platform", "externalSource": "rawg", "externalId": "3328", "title": "...", "coverUrl": "https://..." | null, "releaseDate": "YYYY-MM-DD" | null, "platformLabel"?: string | null, "confirmDuplicate"?: boolean }`.
- `externalId`, `title`, `coverUrl`, `releaseDate` валидируются как в 43.2. `platformLabel`: после trim 1..60, без управляющих символов и `<` `>`; отсутствует/`null` = без подписи. Берётся клиентом из `platforms` кандидата (сервер не сверяет с RAWG).
- Успех: `200 { item: OtherPlatformGame, created: true }`.
- Повтор по `(user_id, externalId, other_platform)`: `200 { item, created: false }`, запись и подпись не меняются; проверка до предупреждения о дубле и лимита. Идемпотентно при гонке. После `DELETE` тот же запрос снова создаёт запись (`created: true`): «Вернуть» работает; если запрос был с `confirmDuplicate`, клиент шлёт его снова.
- Дубль с библиотекой PSN или активным пунктом Плана без `confirmDuplicate: true`: `409 duplicate_game`, `details` как в 43.2. С подтверждением запись создаётся (в `rejected_game_ids` ничего не пишется).
- Лимит: `409 manual_limit`, `details: { limit: 300 }` (для Бэклога `details.limit = 200`).
- Тело без `kind` или с `kind: 'ps_backlog'` = Бэклог (43.2) без изменений. Пакетный `POST /api/manual-games/batch` только для `ps_backlog`, `kind` в его элементах = 400.

`DELETE /api/manual-games/{id}` — без изменений (43.2): удаляет свою запись любого kind, `200 { id, removed: boolean }`, идемпотентно.

### 44.3 Поиск
`GET /api/manual-games/search?q=...&scope=all` — RAWG по ВСЕМ платформам (без `platforms=187,18`, без фильтра `playstation`), `q` 2..80. Только по нажатию: `scope=all` вместе с `mode` = 400. `scope` отсутствует или `ps` = поиск PS5/PS4 (43.3); другое значение = 400. Отдельный кэш процесса 10 мин (ключ: запрос без регистра и лишних пробелов); попадание не тратит лимит; реальный запрос резервирует `provider_usage` (`rawg`, на профиль).
`200 { candidates: (CatalogCandidate & { duplicate: 'library' | 'planned' | null; inBacklog: boolean; inList: boolean })[], cached: boolean }`. `CatalogCandidate.platforms` — полный список имён платформ RAWG (как отдаёт RAWG; порядок RAWG), `playstation: boolean`. `inList = true`, если игра уже в списке `other_platform` этого профиля; `inBacklog` — в Бэклоге (`ps_backlog`). Поле `inList` добавлено и в ответ PS-поиска (всегда присутствует). Ошибки как в 43.3: `503 catalog_unavailable` с `details.reason`, при `rate_limited` `details.resetAt`. БД недоступна: поиск работает, `duplicate = null`, `inBacklog = inList = false`.

### 44.4 Исключения (как отметка «прошёл» Фазы 40)
- «У тебя нет» и подборка «Новое», поиск и «Скоро» в Плане: `rawg_id` записи любого `kind` исключается на чтении (`ownedRawgIds`, `filterOwned`).
- Профиль вкуса, скоринг «Подскажи» (бэклог библиотеки), «Новое от ИИ», Статистика, Итоги, План: строятся из `games`/`game_status`, запись на них не влияет (решение Артёма: только справочник).
- Резервная копия разметки статусов записи не содержит.

### 44.5 Тесты
`src/server/manual/other-platform.test.ts` (PGlite: добавление, идемпотентность, дубль, лимит, изоляция входов и профилей, CHECK, несмешивание с `ps_backlog`, Статистика/Итоги/План/прогноз/Подскажи до и после, исключение из «У тебя нет»), `src/app/api/manual-games/other-platform.routes.test.ts` (401, валидация, Origin, 409, `kind`, поиск `scope=all`, 503 без утечек).

## Фаза 45. Отзыв сессий на сервере (миграция 0027)

### 45.1 Схема (миграция `0027_session_revocation`, только добавляет)
- `allowed_users.session_epoch integer NOT NULL DEFAULT 0` — эпоха сессий входа (значима только у основной строки, `primary_user_id IS NULL`).
- `revoked_sessions (sid text PK, user_id → allowed_users ON DELETE CASCADE, expires_at timestamptz, revoked_at timestamptz DEFAULT now())`, индекс `revoked_sessions_expires_idx`.
- Прод: Артём применяет `docs/release-neon-0027.sql` (идемпотентный, журнал drizzle) и `docs/release-neon-0027-check.sql` ДО деплоя кода; тест `src/db/release-sql-0027.test.ts`. Новый код на старой схеме не читает `allowed_users` (все роуты 503), старый код на новой схеме работает.

### 45.2 Токен
- v:2 дополняется полями `sid` (случайные 128 бит, base64url, при каждом входе) и `se` (эпоха входа на момент входа; 0 не пишется). Переключение профиля (41.2) сохраняет `sid`/`se`.
- Токены до Фазы 45 (без `sid`/`se`) действуют: `se = 0`, ключ отзыва `legacy-<uid>-<iat>`.

### 45.3 Проверка
- `requireUser`: вместе с `resolveAuthContext` (тот же запрос строки входа) проверяется `login.session_epoch = se` и отсутствие ключа сессии в `revoked_sessions` (PK-поиск, параллельно). Иначе `401 unauthorized` и очистка cookie; клиент по 401 уходит на `/login`.
- `proxy.ts` по-прежнему проверяет только подпись и срок (без БД); страницы без данных отрисовываются, все данные идут через `/api/*` под `requireUser`.

### 45.4 Эндпоинты
- `POST /api/auth/logout` — см. 3.5: отзывает текущую сессию; просроченные записи `revoked_sessions` удаляются тем же вызовом.
- `POST /api/auth/logout-all` — «Выйти на всех устройствах» (owner и member). Требует сессию (`requireUser`), `Content-Type: application/json`, `Origin` как в 3.4. `session_epoch` основной строки входа + 1, все сессии входа (включая доп. профили и текущую) отклоняются. `200 {"ok":true,"data":{}}` + очистка cookie; `401` без сессии; `400 invalid_request`; `503 db_unavailable`.
- UI: пункт «Выйти на всех устройствах» в меню профиля (десктоп) и в листе «Меню» (мобильный), с подтверждением.

### 45.5 Тесты
`src/server/auth/session-revocation.test.ts` (PGlite, настоящие cookie: sid/se, переключение профиля, старые токены, выход, выход везде, Origin, очистка), `src/db/release-sql-0027.test.ts`, `e2e/phase45-logout.spec.ts`.
