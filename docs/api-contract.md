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
| `error_reason` | `sync_error_reason` | да | заполняется при `failed` и `partial`. **`auth_expired`**: refresh token PSN протух (живёт ~10 дней, `docs/api-notes.md`) или обмен не удался, нужен новый NPSSO. `npsso_invalid`: переданный NPSSO отвергнут PSN. `access_denied`: цель закрыла список игр/трофеи или перестала быть другом. `rate_limited`: 429 после исчерпания повторов. `psn_unavailable`: 5xx/сеть. `timeout`: функция близка к лимиту, остаток отложен. `internal`: наша ошибка |
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
- Единственный пароль `ADMIN_PASSWORD`, пользователей нет.
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
- Глобальный лимит: **20 неудачных попыток за час на всех** -> `429` (защита от ротации IP).
- При неверном пароле ответ с искусственной задержкой 500 мс.
- Успешный вход не сбрасывает счётчик (запись `success = true`, в лимит не входит).
- Атомарность: проверка лимита и запись попытки идут в одной транзакции под `pg_advisory_xact_lock`. Попытка записывается как неудача (`success = false`) **до** сравнения пароля; при верном пароле запись обновляется до `success = true`. Заблокированный запрос (429) ничего не пишет. Параллельная пачка неверных паролей не может превысить лимит.
- Источник: таблица `login_attempts` (1.10).
- Проверка лимита идёт **до** сравнения пароля, чтобы заблокированный IP не мог ничего проверять.

### 3.4 Proxy (`src/proxy.ts`, бывший middleware)
Matcher: `/api/*` проходит через proxy всегда (расширение в пути не пропускает). Остальные пути, кроме `_next/static`, `_next/image`, `favicon.ico` и файлов с расширениями статики (иконки, шрифты), тоже. Логика:

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
- 200: `{"ok":true,"data":{}}` + `Set-Cookie: pst_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`.
- Идемпотентен: без сессии тоже 200.

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
| `TELEGRAM_CHAT_ID` | нет | сервер | Этап 2 (15.4): id чата (личный чат с ботом или группа), куда бот шлёт сообщения |
| `RAWG_API_KEY` | нет | сервер | Фаза 12 (17.2, 17.9): ключ rawg.io/apidocs для поиска релизов. Без него поиск отвечает `503 catalog_unavailable`. Секрет: не логируется, не попадает в ответы |
| `APP_TIMEZONE` | нет | - | **не используется**: часовой пояс жёстко `Europe/Moscow` в константе кода |

Запрещено: логировать любую из переменных, `PSN_NPSSO`, токены, заголовки `Authorization` и `Cookie`. В `error_message` синка токены вырезаются.

## 6. Правила миграций
1. Источник истины схемы: `src/db/schema.ts`. SQL-миграции генерирует `drizzle-kit generate` в `src/db/migrations/`, коммитятся в репозиторий. Править сгенерированный SQL вручную можно только для данных/индексов, которые drizzle не выражает (партиальные индексы, CHECK, partial UNIQUE), с комментарием.
2. Применение: `drizzle-kit migrate` по `DATABASE_URL_UNPOOLED`, отдельным шагом (скрипт `db:migrate`), **не** при старте приложения и не в рантайме функции.
3. Миграции только вперёд (down-миграций нет); исправление = новая миграция. Одна миграция = одно логическое изменение.
4. Совместимость: двухшаговые изменения (expand -> contract). Добавление колонки с default или nullable безопасно; переименование и удаление делаются отдельной миграцией после выката кода.
5. **Миграции с потерей данных** (`DROP TABLE/COLUMN`, сужение типа, `TRUNCATE`, `DELETE` без возможности восстановления) требуют согласия Артёма через оркестратора. В заголовке такой миграции комментарий `-- DATA LOSS: <что теряется>`.
6. Применение к проду только с согласия оркестратора; до этого проверка на отдельной ветке Neon (branching) или локальной БД.
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
3. Предохранители: `cursor.hops` не больше 20 (затем запуск остаётся `partial`); проверяется и у отправителя, и у получателя: `continue` без `hop` = `400`; `hop` больше 20, не равный `cursor.hops` запуска (повтор старого вызова) или `cursor.hops` больше 20 = `200 not_resumable`; `continue=<runId>` возобновляет только запуск `partial` с `error_reason = 'timeout'`; один `running` на систему (партиальный UNIQUE, 1.7).
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
Детали игры для окна. Сессия, конверт 4.1. `id` не число = `400 invalid_request`, нет игры = `404 not_found`. Скрытая игра отдаётся (`hiddenAt` не `null`).

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

**Ограничение данных PSN.** В БД нет `trophyGroupId` (PSN его отдаёт, схема его не хранит), поэтому трофеи DLC входят в `required`/`remaining`, хотя для платины не нужны. Для игр с DLC прогноз занижен (`progress`) и завышен (`remaining`). Исправление требует миграции (колонка `trophies.group_id`), в Фазе 15 не делается.

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

### 15.4 Предупреждение о протухании NPSSO в Telegram (15.6)

**Переменные** (раздел 5, обе необязательные): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Не заданы обе: модуль ничего не делает (ни запросов, ни записей в БД, ни ошибок). Токен не логируется и не попадает в тексты ошибок.

**Модуль** `src/server/notify/telegram.ts`: `sendTelegram(text)` через `POST https://api.telegram.org/bot<token>/sendMessage` (JSON `{chat_id, text, disable_web_page_preview: true}`, таймаут 8 с). Любая ошибка (сеть, не 2xx, исключение) проглатывается и возвращает `false`; в `console.error` пишется только короткий код без URL и токена. Проверки и дедуп: `notifyAfterSync` (см. ниже).

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
- `hltb.status`: `found | not_found | unchecked`; при не `found` `id`, `name`, `mainHours`, `extraHours` = `null`; `checkedAt` может быть не `null` при `not_found`.

### 16.4 `GET /api/games` (9.2): новые параметры
| Параметр | Значение | По умолчанию |
|---|---|---|
| `genres` | список ключей жанров через запятую (ключи 1.9: `ACTION`, `ROLE_PLAYING_GAMES`, ...). Игра подходит, если среди её эффективных жанров (1.9) есть хотя бы один из выбранных (ИЛИ). Регистр не важен. Неизвестный ключ = `400`. Служебное значение `none` = «без жанра»: у игры нет ни одного жанра (ни `genres_override`, ни `psn_genres`); сочетается с обычными ключами по ИЛИ (`genres=none,HORROR`). По 1.9 такая игра показывается как `OTHER`, поэтому фильтр `OTHER` её тоже захватывает; `none` выделяет только их | без фильтра |
| `duration` | список бакетов 16.2 через запятую (ИЛИ), например `lt10,unknown`. Неизвестный = `400` | без фильтра |
| `hltb` | список статусов HLTB через запятую (ИЛИ): `found` (`hltb_id` есть), `not_found` (`hltb_id` пуст, `hltb_checked_at` задан), `unchecked` (оба пусты). Регистр не важен (`FOUND` = `found`). Это тот же `duration.hltb.status` из 16.3. Ручное значение (`duration_override_hours`) на статус НЕ влияет: игра с override и без совпадения в HLTB остаётся `not_found` и попадает в `hltb=not_found` (так Артём видит, где HLTB не нашёл игру, даже если часы введены руками). Неизвестное значение = `400` | без фильтра |
| `sort=duration` | по эффективным часам; `order` по умолчанию `asc`; игры без длительности всегда в конце (NULL last), как в 9.2 | |

Фильтры комбинируются с `status`/`q`/`year` через И. `counts` (9.2) теперь учитывает также `genres`, `duration` и `hltb` (табы статуса показывают, сколько игр осталось при выбранных чипах). В типах `sort=duration` это `ListSort`, `GameSort` не менялся. Типичный запрос бэклога: `status=backlog&genres=ACTION&duration=10_30&sort=duration`.

В ответ добавляется `hltbCounts`: `{"found":150,"not_found":20,"unchecked":44}`. Считается по тем же `q`/`status`/`year`/`forgotten`/`hidden`/`genres`/`duration`, но БЕЗ фильтра `hltb`. Все три ключа всегда присутствуют (в т.ч. нулевые), сумма = число игр в области.

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
- Кого обновляем: видимые игры без `duration_override_hours` и со статусом `backlog`, `playing`, `shelved` или без статуса (не `completed`/`dropped`/`service`), у которых `hltb_checked_at` NULL или старше 30 дней. Порядок: `backlog`, `playing`, `shelved`, без статуса. За звено не больше 20 игр и пока в бюджете времени осталось >= 3 с.
- Защита от сломанного HLTB: если в запуске шага НИ ОДИН запрос не вернул непустую выдачу (при любом размере партии, 1 игра тоже), «не найдено» не записывается, игры остаются непроверенными, в `warnings` пишется `hltb_empty`. «Не найдено» фиксируется только когда в том же запуске был хотя бы один нормальный (непустой) ответ HLTB. Цена: реально неизвестная HLTB единственная новая игра будет перепроверяться каждый синк (один запрос), пока в партии не появится нормальный ответ, и каждый раз давать `hltb_empty`; ручной ввод длительности (16.5) исключает игру из шага.
- Нет совпадения: `hltb_id`, `hltb_name`, `hltb_*_hours` = NULL, `hltb_checked_at = now` (`not_found`, перепроверка через 30 дней). Ошибка HLTB: игра не помечается проверенной, после 3 ошибок подряд шаг прекращается, в `sync_runs.warnings` пишется `hltb_failed` (код ошибки без тела ответа). Итог запуска не меняется (`success` остаётся `success`).
- Если HLTB вернул время, а позже оно пропало (NULL), прежнее значение сохраняется (`coalesce`), как для остальных необязательных полей PSN.

### 16.7 `POST /api/hltb/run`: массовая подгрузка длительности
Запускает ТОЛЬКО шаг HLTB (к PSN не обращается, секреты PSN не нужны), чтобы подтянуть длительность сразу для всех подходящих игр, а не по 20 за суточный синк. Фронт вызывает эндпоинт в цикле, пока `done=false`.
- Доступ: сессия (`src/proxy.ts`), `Content-Type: application/json`, проверка `Origin` (3.4), тело необязательное: `{}` или `{"recheckNotFound": true, "since": "<ISO>"}`. `maxDuration = 60`.
- Перепроверка «не найдено» (после смены матчера 16.6): `recheckNotFound` (boolean, по умолчанию `false`). При `true` обязателен `since` (ISO-время; в будущем сверх допуска 5 секунд на разброс часов = `400 invalid_request`, `details: {"reason":"since_in_future"}`, значение НЕ обрезается до «сейчас»: растущая граница зацикливала бы перепроверку; без `since` или не ISO тоже `400`), и в отбор дополнительно входят игры с `hltb_id IS NULL` и `hltb_checked_at < since` (то есть прежние `not_found`), даже если им нет 30 дней; остальные условия отбора те же (скрытые, ручные, `completed/dropped/service` не трогаются). Найденные (`hltb_id` есть) не перепроверяются, значения не затираются. Фронт фиксирует `since = now` один раз в начале цикла (при часах клиента впереди сервера более чем на 5 секунд берёт серверное время, например из заголовка `Date` первого ответа, или вычитает запас) и передаёт то же значение во всех вызовах: перепроверенные игры получают `hltb_checked_at >= since` и выходят из отбора, цикл конечен. `remaining` при `true` считается с учётом этой перепроверки.
- Правило отбора то же, что в 16.6 (видимые, без `duration_override_hours`, статусы `backlog`/`playing`/`shelved`/без статуса, `hltb_checked_at` NULL или старше 30 дней), порядок тот же. Те же правила: пауза 600 мс между запросами, остановка после 3 ошибок подряд, защита `hltb_empty`.
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

### 17.4 Модель плана (алгоритм `src/server/roadmap/`, чистые функции)
Время ведётся по дням года (1 января..31 декабря выбранного года). Бюджет `b` = `hoursPerWeek`, в день `b / 7`.

**Недели.** Это НЕ ISO-недели. Неделя = понедельник..воскресенье по МСК; первая и последняя недели обрезаются границами года (1 янв и 31 дек), `days` < 7, ёмкость обрезанной недели `b * days / 7`. Причина: план одного года не смешивается с соседним (ISO-неделя 1 может начинаться в декабре прошлого года), суммарная ёмкость года ровно `b * днейВГоду / 7`. Нумерация `index` с 1 подряд внутри года. Год из 365 дней даёт 53 строки `weeks`, из 366 тоже (понедельники делят год по-разному, первая и последняя обрезаны).

**Игры плана** (`kind`):
- `release`: `planned_games` со `status = 'planned'`, `want_at_release = true` (дата обязательна по CHECK). Ставятся жёстко ПЕРВЫМИ.
- `backlog`: `games` со статусом `backlog`, видимые (`hidden_at` is null). Очередь в порядке `roadmap_order.position` asc, затем игры без позиции в порядке попадания в бэклог (`game_status.status_changed_at` asc, затем `games.id`).
- `planned`: `planned_games` со `status = 'planned'` БЕЗ галки. Идут в очередь ПОСЛЕ всех игр бэклога, по `release_date` (NULL в конце), затем `id`, и не раньше своей даты выхода (если она есть). Допущение: в решениях Артёма про такие игры нет явного правила.

**Часы игры.** `backlog`: `duration_override_hours` приоритетнее `hltb_main_hours` (`hoursSource`: `manual` | `hltb`). `release` и `planned`: `hours_manual` (`manual`). Нет часов или `<= 0` = игра в `needHours`, в плане не участвует.

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
- Ошибки: `503 db_unavailable` (любая внутренняя ошибка, как в 16.7). Ошибка PSN невозможна (эндпоинт PSN не трогает).

### 17.6 Прогресс (`progress`)
Сравнивает факт часов из `playtime_snapshots` с тем, сколько по плану должно быть сыграно к сегодняшнему дню.
- Игры плана: игры, у которых есть строка в `roadmap_order`, плюс текущая очередь бэклога (`kind = backlog`). Из этого множества исключаются игры со статусом `service` и игры, исключённые из плана (`roadmap_excluded`, 17.12); `completed` остаются (17.11). Строки `roadmap_order` при смене статуса игры не удаляются (в т.ч. `PUT /order` трогает только строки текущего бэклога и переданных id), поэтому начатая или пройденная игра остаётся в плане для прогресса.
- Факт: часы по снимкам (расчёт 1.6: `secondsByGame`) ТОЛЬКО по играм плана. Плановые часы тоже только по ним (`items` с `gameId` из этого множества).
- Ограничения (связи нет, не выдумываем): релизные игры (`planned_games`) после покупки не связаны с записью в `games`, поэтому их часы в факт и план прогресса не входят; игра, ушедшая из бэклога до первого `PUT /order` и не имеющая строки в `roadmap_order`, в план прогресса не попадает; игра, ушедшая из бэклога, выпадает из `items`, поэтому её плановые часы в прогрессе пропадают, а факт остаётся.
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
- `LLM_DAILY_LIMIT`: потолок вызовов в сутки МСК, по умолчанию 20, диапазон 0..200 (0 = выключен).
- `LLM_MODEL`: необязательно, модель провайдера (по умолчанию `gemini-2.5-flash-lite` / `llama-3.1-8b-instant`); нужна, чтобы сменить устаревшую модель без правки кода. Допустимы символы `[\w.:/-]`, иначе игнорируется.
Без ключа или провайдера всё работает на шаблонах (`meta.llm = "disabled"`).

### 18.3 Скоринг (`src/server/recommend/score.ts`, чистая функция, без env/БД/сети)
Кандидаты: игры со статусом `backlog`, `hidden_at` is null, не в `recommend_dislikes`. Статус `service` не участвует.
Балл = сумма взвешенных сигналов, каждый в диапазоне `[-1, 1]`, веса — константы в одном месте и покрыты тестами:
- `genre_affinity` (вес 3): для жанров игры (`genres_override` приоритетнее `psn_genres`, словарь из `src/shared`, игра делится по 1/N) считается `часы_жанра_в_играх_completed+playing` и `доля completed − доля dropped` по жанру, нормируется по библиотеке. Нет истории по жанру → 0.
- `duration_fit` (вес 2): по запросу `time`; часы = `duration_override_hours` > `hltb_main_hours`. Окна: `short` ≤ 8 ч, `medium` 8..30 ч, `long` > 30 ч, `any` = сигнал 0. Попадание в окно +1, промах линейно к −1. Нет часов → 0 и пометка «длительность неизвестна».
- `platinum_close` (вес 1.5): доля уже полученных трофеев набора (если игра в бэклоге, но начата) и отсутствие DLC-хвоста; нет трофейного набора → 0.
- `waiting` (вес 1): давность `game_status.status_changed_at` в бэклоге, насыщается на 365 днях.
- `dropped_genre_penalty` (вес −2): жанры, у которых доля dropped > 50% при ≥ 3 играх.
Тай-брейк: `game.id` asc. Одинаковый вход даёт одинаковый выход (детерминизм, Date.now не используется внутри — «сейчас» передаётся аргументом).
Выход: топ-3 (меньше, если кандидатов меньше) с `signals` (ключ, подпись RU, вклад в балл).

### 18.4 `GET /api/recommend?time=any|short|medium|long`
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

## 19. «Подскажи»: два режима, «Новое от ИИ» через Groq + RAWG (Фаза 13b)

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
1. Если для текущих суток МСК есть кэш с тем же `profile_hash` — берём его, LLM не вызываем. `?refresh=1` игнорирует кэш, но не чаще 3 раз в сутки (иначе `meta.refreshLeft = 0` и кэш) и расходует `LLM_DAILY_LIMIT` как обычный вызов.
2. Запрос в Groq (`response_format: json_object`, температура ≤ 0.7, таймаут 15 с, `LLM_MAX_OUTPUT_TOKENS`): просит РОВНО 15 реально существующих игр на PlayStation, НЕ из переданного списка, формат `{ "games": [ { "title": str, "year": int|null, "reason": str<=200 } ] }`. Ответ парсится и валидируется: до 15 элементов, `title` 1..120, без ссылок (правило 18.8), `reason` 1..200 без ссылок; нарушающие элементы отбрасываются.
3. Подтверждение в RAWG для каждого названия: `searchCatalog(title, { playstationOnly: true })` (существующий клиент, раздел 17.9), до 3 параллельно, общий бюджет 20 с. Кандидат принимается, если нормализованное название результата равно предложенному (нижний регистр, без знаков и артиклей, «ё»=«е», римские/арабские цифры не сравниваются) ИЛИ сходство строк ≥ 0.9, и (если год известен и у RAWG есть дата) `|год − годРелиза| ≤ 1`. Берётся первый подходящий результат. Нет совпадения → кандидат отбрасывается.
4. Успешный результат пишется в `recommend_discover_cache` (если подтверждено ≥ 1 игра; иначе не кэшируем, чтобы не залипнуть на пустом).
5. Каждая реальная попытка вызова Groq списывает лимит (`reserveLlmCall`, как 18.4); при исчерпании → `meta.llm = "limit"`, отдаём последний кэш за любые сутки, если он есть, иначе `items: []`.

### 19.5 Фильтрация при выдаче (на каждый `GET`, без LLM)
Из кэшированных кандидатов убираются: уже в библиотеке (нормализованное совпадение с `games.name` и `games.hltb_name`, любой статус, включая скрытые игры), уже в `planned_games` в статусах `planned|done` (`cancelled` остаётся доступным), и скрытые в `recommend_external_dislikes` (неистёкшие). Отдаётся до 9 штук в порядке ответа модели.

### 19.6 `GET /api/recommend/discover[?refresh=1]`
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
