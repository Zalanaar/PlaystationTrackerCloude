# API-контракт PS Tracker

Версия: 1.2 (Фаза 1; раздел 8 «Синк» добавлен в Фазе 2; раздел 9 «Коллекция» в Фазе 3). Статус: черновик на согласование с оркестратором. Код (`src/db/schema.ts`, auth, middleware) пишется строго по этому документу. Любое отклонение сначала правится здесь.

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
| `game_status_value` | `playing`, `completed`, `dropped`, `backlog`, `shelved` |
| `trophy_type` | `bronze`, `silver`, `gold`, `platinum` |
| `trophy_set_link_source` | `title_id`, `concept`, `name`, `manual` |
| `sync_run_kind` | `daily` (cron), `manual` (кнопка/ручной запуск), `trophy_backfill` (дозагрузка трофеев) |
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
| `created_at` / `updated_at` | timestamptz | нет, default now() | `updated_at` обновляется приложением при апсёрте |

Индексы: UNIQUE `games_title_id_key (title_id)`; `games_concept_id_idx (concept_id)`; `games_last_played_at_idx (last_played_at desc nulls last)`; GIN `games_psn_genres_gin (psn_genres)` не нужен для MVP (жанры агрегируются в коде).

Upsert синка: `INSERT ... ON CONFLICT (title_id) DO UPDATE` по всем PSN-полям. Поля `genres_override` и всё из других таблиц не затрагиваются. Если PSN отдал `play_duration_seconds` меньше сохранённого, сохраняется значение из PSN (PSN авторитетен), но это логируется как предупреждение в `sync_runs.warnings` (см. 1.7).

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
- Формула часов за период `[from, to]` (даты МСК, включительно) для игры: `S_end - S_base`, где `S_end` = последний снимок с `snapshot_date <= to`, `S_base` = последний снимок с `snapshot_date < from`. Если базового снимка нет (до первого синка истории нет), берётся первый снимок внутри периода, и часы до него не учитываются (дельта от первого снимка). Отрицательные дельты обнуляются. Реализация в `src/server/stats/` с Vitest.
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
- Нормализация в `src/server/stats/genres.ts` (или рядом): `SIMULATOR` -> `SIMULATION`; `UNIQUE` -> `OTHER`; прочее как есть в нижнем ключе из словаря; неизвестное значение -> `OTHER` (и предупреждение в тестах, не падение). Дубликаты после нормализации схлопываются.
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
psn_auth (singleton), login_attempts (самостоятельная)
```

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
| 409 | `status_conflict` | дату завершения/броска правят у игры, чей статус не соответствует (9.5) |
| 429 | `rate_limited` | перебор пароля |
| 500 | `config_error` | не заданы или невалидны обязательные env |
| 500 | `internal_error` | прочее |
| 503 | `db_unavailable` | БД недоступна |

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
  ]
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
| `status` | `playing \| completed \| dropped \| backlog \| shelved` или `null` («без статуса») |
| `completedAt` / `droppedAt` | ISO UTC; не `null` только при соответствующем статусе (1.3) |
| `trophies` | `null`, если у игры нет трофейного сета (нет строк в `game_trophy_sets`) или в сетах `defined = 0`. UI показывает «нет данных». Иначе объект |
| `trophies.earned` / `defined` | сумма `earned_*` / `defined_*` по всем сетам игры (правило 1.4; значения из `trophy_sets`, кэш `getUserTitles`) |
| `trophies.progress` | целое 0..100: `round(earned / defined * 100)`. Это не `trophy_sets.progress` PSN (его взвешивание по типам не используется) |
| `trophies.platinumDefined` / `platinumEarned` | в сетах есть платина / платина получена (`sum(defined_platinum) > 0`, `sum(earned_platinum) > 0`) |
| `trophies.byType` | `earned`/`defined` по типам для нижней полосы карточки |
| `genres` | эффективные жанры по 1.9: `genres_override ?? normalize(psn_genres)`, подписи RU из словаря. Порядок как у PSN, дубли схлопнуты. Никогда не пустой массив: нет данных = `[{"key":"OTHER","label":"Другое"}]`. Ключи: `ACTION, ADVENTURE, ROLE_PLAYING_GAMES, SHOOTER, HORROR, RACING, SIMULATION, FIGHTING, ARCADE, MUSIC_RHYTHM, CASUAL, STRATEGY, PUZZLE, FAMILY, PARTY, OTHER` |

### 9.2 `GET /api/games`
Query-параметры (все необязательные; неизвестные игнорируются):
| Параметр | Значение | По умолчанию |
|---|---|---|
| `q` | поиск по названию, подстрока, регистронезависимо (`ILIKE`, спецсимволы `%` `_` `\` экранируются). Пробелы по краям обрезаются, пустая строка = без поиска. Максимум 100 символов, больше = `400` | нет |
| `status` | список через запятую из `playing, completed, dropped, backlog, shelved, none` (`none` = без статуса). Несколько = объединение (ИЛИ). Дубли допустимы. Неизвестное значение = `400` | все |
| `year` | целое 2000..2100, см. правило года ниже. Иначе `400` | все годы |
| `sort` | `last_played \| hours \| title \| trophies_progress \| completed_at` | `last_played` |
| `order` | `asc \| desc` | зависит от `sort` (ниже) |
| `limit` | 1..300 | 60 |
| `offset` | >= 0 | 0 |

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
    "counts": { "all": 214, "playing": 3, "completed": 61, "dropped": 9, "backlog": 25, "shelved": 4, "none": 112 },
    "years": [2026, 2025, 2024]
  }
}
```
- `total`: число игр после **всех** фильтров (`q`, `status`, `year`), до `limit/offset`. Страница = `items`.
- `counts`: для табов статуса. Считаются с учётом `q` и `year`, но **без** фильтра `status` (иначе нельзя показать, сколько игр в соседнем табе). `all` = сумма остальных шести. Все семь ключей присутствуют всегда, при пустой БД нули.
- `years`: годы завершений (по правилу года: только `completed_at`/`dropped_at`), в которых завершена хотя бы одна игра во **всей** коллекции (без `q`/`status`), по убыванию. Для выпадающего списка «Все годы». Пустая БД: `[]`.
- Пустая БД / нет совпадений: `items: []`, `total: 0`, счётчики нули, `200`.
- `offset` за пределами: `items: []`, `total` настоящий.

### 9.3 `GET /api/collection/summary`
Данные для шапки статистики (4.2), блока «Играю сейчас» (4.3) и секции «Продолжить».
```json
{
  "ok": true,
  "data": {
    "totals": { "games": 214, "playSeconds": 6943201, "hours": 1928.7, "trophiesEarned": 4310, "platinumEarned": 38 },
    "counts": { "all": 214, "playing": 3, "completed": 61, "dropped": 9, "backlog": 25, "shelved": 4, "none": 112 },
    "playing": [ { "...": "GameItem" } ],
    "continue": [ { "...": "GameItem" } ]
  }
}
```
- `totals.games` = строки `games`; `playSeconds`/`hours` = сумма по `games.play_duration_seconds` (`hours` до 0.1); `trophiesEarned` = строки `trophies` с `earned = true`; `platinumEarned` = из них `type = 'platinum'` (как `totals` в 8.4, включает трофеи сетов-сирот, поэтому может быть больше суммы по `GameItem`).
- `counts`: как в 9.2 без фильтров.
- `playing`: все игры со статусом `playing`, сортировка `last_played_at desc nulls last, lower(title), id`, максимум 20. UI берёт `playing[0]` для блока «Играю сейчас» (4.3 «с самым свежим последним запуском»); пусто = блок скрыт.
- `continue`: до 8 игр для секции «Продолжить». **Правило:** `last_played_at IS NOT NULL` и статус не `completed` и не `dropped` (то есть `playing`, `backlog`, `shelved`, без статуса), сортировка `last_played_at desc, id desc`. Игры, включённые в `playing`, **не исключаются** (дизайн 4.3: «playing + недавно запущенные»); если блок «Играю сейчас» уже показывает `playing[0]`, дубль на карточке в ряду фронтенд убирает сам. Окна по давности нет: при малом числе подходящих игр ряд короче 8 или пуст.
- Пустая БД: нули, `playing: []`, `continue: []`.

### 9.4 `PUT /api/games/{id}/status`
Тело: `{"status": "playing"}` где `status` одно из пяти значений либо `null` (сброс в «без статуса» = `DELETE` строки `game_status`). Остальные поля тела игнорируются; `status` обязателен (отсутствующий ключ = `400`).
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
- `ids`: массив положительных целых, 1..250 штук. Дубли схлопываются без ошибки. Больше 250 или пустой = `400`.
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
