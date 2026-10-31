# QA: Фаза 20.4 (обход пользователей, /api/me/psn, лимиты LLM, онбординг) + 0015, приёмка

Ветка `claude/beautiful-mendel-dpb5f5`, HEAD `4eea3e8`. Дата: 2026-10-31. Прод: `0013`, `0014`, `0015` применены (0015 проверена check-запросом).

## Вердикт: принято с замечаниями

Блокеров нет. Утечек данных между пользователями нет; код совместим со схемой после `0015`. Условия: перед деплоем сделать проверку владельца в Neon (R-1), W-1 исправить до включения `MULTIUSER_ENABLED`.

## Результаты

| Пункт | Итог |
|---|---|
| 1. Изоляция | `user_id` везде в новых функциях (`listSyncUsers`, `getPsnState`, `setPsnAccess`, `recheckPending`, `reserveCall`/`releaseCall`/`usedToday`, `markOnboarded`, watchdog, копия). Мутации ниже. `user-isolation*`, `blocked.test` зелёные. |
| 2. Cron-обход | Тесты `cron/sync/queue.test.ts` проходят: 2+ пользователя по порядку id, сбой (failed и исключение) не останавливает, blocked/invited/без ника/private не синкаются, `?continue=` blocked -> `user_inactive`, `?queue=` берёт только больший id, глобальный «один running» (`already_running`), владелец без ника -> `PSN_TARGET_ONLINE_ID`, чужой ник из env member не подставляется (мутация «fallback всем» роняет 7 тестов). `?queue` строго растёт по id: зацикливания нет. Без Bearer/с чужим секретом: 401 (route и `proxy.ts`). Движок в этих тестах подменён, реальный `runChunk` двух пользователей покрыт `post-0015-sync.test.ts`. |
| 3. `/api/me/psn` | Все коды 22.13 покрыты `route.test.ts` (200/400/409 taken+locked/422/429+Retry-After/503/500), рабочий ok-ник не затирается, member без ника -> `POST /api/sync` 409 `psn_not_set`. |
| 4. Лимиты LLM | Общий потолок по сумме, на пользователя, на вид, возврат, новые сутки, 6 параллельных вызовов под advisory-локом не перешагивают потолок (`budget-users.test.ts`). |
| 5. 0015 | Все `ON CONFLICT` в `src/` (28 мест) сверены с ключами схемы: цели существуют (в т.ч. B-1 закрыт: `recommend_reasons (user_id, game_id, signals_hash)`). `post-0015-sync.test.ts` (PGlite, все 16 миграций): синк двух пользователей с общими `title_id`, идемпотентность. |
| 6. Онбординг | Guard: `onboarding-guard.test.ts` (новый, 4 теста): владелец не редиректится и API не зовёт; member без ника/без `onboardedAt` -> `/onboarding`; 401/503/сеть/мусор/нет сессии/нет host -> fail-open. `/onboarding` вне группы `(app)`, поэтому цикла редиректов нет (на `/` его возвращает сам экран при `onlineId && onboardedAt`). 409 `sync_in_progress` при повторном POST: очередь с опросом раз в 2,5 с, e2e зелёный. Риск «Готово» без `onboardedAt`: W-1. |
| 7. Регрессия | `tsc` и `eslint .` чисты. `vitest run`: 159 файлов, 2727 тестов зелёные (до моих добавлений); с добавленными +2 файла, +7 тестов, зелёные. Cookie `v:1` отвергается (`session-v2.test.ts`, `flow.test.ts`). e2e: onboarding, phase20-access, auth, security-headers на desktop+mobile: 106 из 106. Полный desktop: ~503 из 832 без падений (остановлен по времени). |

## Мутационная проверка (вручную, откачено)

Прогон: cron, me/psn, psn-access, budget-users, user-isolation*, blocked, post-0015-sync, service, notify.

| Мутация | Результат |
|---|---|
| `listSyncUsers` без `status='active'` | упал (3) |
| fallback-ник владельца подставляется всем | упал (7) |
| `setPsnAccess` проверка `taken` включает себя | упал (3) |
| `reserveCall` сумма без фильтра по суткам/общая | упал (4); без лимита пользователя упал (1); `releaseCall` без `userId` упал (1) |
| `launchSync` без проверки `status` | упал (2) |
| watchdog: дубль owner / всегда user 1 | упал (3 / 1) |
| `getPsnState`: `sync_runs` без `user_id` | **выжила** (чужой запуск в чужом `/api/me/psn`) -> тест добавлен, теперь падает |
| `psn_account_locked`: `count(games)` без `user_id` | **выжила** -> тест добавлен, теперь падает |
| `markOnboarded` без `id` (все пользователи онбордятся) | **выжила** -> тест добавлен, теперь падает |

Новые тесты: `src/server/qa-phase-20-4.test.ts`, `src/app/(app)/onboarding-guard.test.ts`.

## Замечания

### W-1 (major, до `MULTIUSER_ENABLED`): ловушка онбординга без `onboardedAt`
`onboarded_at` ставится только в `work()` после `success` (`src/server/sync/service.ts`, `markOnboarded` глотает ошибку). В `OnboardingView.tsx` после 6 опросов без `onboardedAt` (`confirmTries > 6`) экран всё равно показывает «Готово». Нажатие ведёт на `/` или `/triage`, guard видит `onboardedAt = null` и возвращает на `/onboarding`. Так же застрянет member, у которого `success`-запуск был до 20.4 (`onboarded_at` null). Шагов на выход нет, кроме действий владельца.
Воспроизведение: member с ником `ok`, сбой UPDATE `onboarded_at` (или ручной `update allowed_users set onboarded_at = null` после успешного синка) -> открыть любую страницу.
Исправление (backend/frontend): в `GET /api/me/psn` проставлять `onboarded_at`, если есть `success`-запуск пользователя; либо guard пропускает при наличии success.
Сейчас в проде не проявится: `MULTIUSER_ENABLED` выключен, member нет.

### W-2 (minor): `?queue` в контракте и в коде
22.13: «N = номер шага обхода, 1..100» и «берётся первый, у кого за сегодня нет завершённого запуска». В коде `queue = id только что закончившего пользователя`, фильтра «за сегодня» нет. Следствие: повторный ручной вызов cron за день пересинкает всех. Привести контракт к коду.

### W-3 (minor): общий потолок LLM и порядок обхода
По умолчанию `LLM_DAILY_LIMIT=20`, на пользователя 12. Владелец (id=1) идёт первым и занимает до 12, остальным остаётся 8 на всех. При 2+ активных пользователях задать `LLM_DAILY_LIMIT` не меньше `число_пользователей × 12` (в контракте сказано, в `.env.example`/Vercel проверить).

### W-4 (minor): guard
(а) Для member каждая навигация делает self-fetch `/api/me/psn` (до 4 с таймаут, лишний вызов функции). (б) Хост для fetch берётся из `x-forwarded-host`/`host` запроса; на Vercel значение задаёт платформа, но лучше `getSyncOrigin()`. Cookie уходит только свой.

### W-5 (minor): алерты watchdog для member
Член с закрытым профилем (`ok` в БД, PSN потом закрыт) даёт ежедневный `sync_missed:<id>` с текстом «Проверьте cron и NPSSO». Текст вводит в заблуждение. Ник теперь подписан, это смягчает.

### W-6 (minor): ник владельца
Если у владельца в `allowed_users` нет `psn_online_id`, а `PSN_TARGET_ONLINE_ID` задан, любой member может занять этот ник (проверка `taken` смотрит только `allowed_users`). Это не утечка (данные раздельны, профиль публичный), но два пользователя получат одну коллекцию. Закрыть: `taken` сверять и с `PSN_TARGET_ONLINE_ID`.

## Риски деплоя (прод на `0015`, код 20.3 уже в `main`)

R-1 (проверить ДО выкладки, Neon): `select id, role, status, psn_online_id, psn_access_status from allowed_users where role='owner';`. С 20.4 владелец с непустым `psn_online_id` синкается по нему, а не по `PSN_TARGET_ONLINE_ID`, и только при `psn_access_status='ok'`. Если ник отличается от env или статус не `ok`, ночной синк владельца молча пропустится (ручной вернёт 409 `psn_not_verified`). Должно быть: ник равен `PSN_TARGET_ONLINE_ID`, статус `ok`, `status='active'`.
R-2: порядок: код 20.4 можно выкатывать сразу (миграций 20.4 нет, 0015 уже в проде). Окно 0015 -> деплой кода 20.3 закрыто, кэш фраз идёт по новому ключу.
R-3: у владельца разлогинятся все старые cookie `v:1` (удалены): войти Google или `ADMIN_PASSWORD`, один раз.
R-4: обход зависит от самовызова (`SYNC_ORIGIN`/`VERCEL_URL`, `CRON_SECRET`); без них cron синкает только владельца. Пока других пользователей нет, поведение владельца не меняется.
R-5: владелец не редиректится на онбординг (роль из подписанной cookie); `onboarded_at` у него останется null, не страшно.
R-6: откат: код назад на 20.3 безопасен (миграций нет).

## Что не удалось проверить
- Полный e2e: desktop ~503 из 832, mobile целиком не запускался (только 4 файла выше).
- Реальные Neon, Vercel cron/самовызов `?queue=`, PSN/NPSSO, Telegram, Groq/RAWG: фикстуры и моки. Реальный `runChunk` в связке с `queueChain` не проверен (в тестах обхода движок подменён).
- Реальный redirect-guard с настоящим self-fetch в браузере (e2e мокает API на стороне браузера, серверный fetch не мокается): покрыт только юнит-тестом.
- Счётчики RAWG/HLTB по пользователям (открыто в 22.13, нужна миграция).
