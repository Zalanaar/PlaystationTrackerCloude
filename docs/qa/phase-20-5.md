# QA: Фаза 20.5 (изоляция, роли, миграции 0013-0015, два пользователя) + повторная проверка W-1..W-6

Ветка `claude/tender-hawking-6ykve3`, HEAD до QA `4d8dd0c`. Дата: 2026-10-31.

## Вердикт: принято

Блокеров нет. W-1..W-6 закрыты. Утечек данных между пользователями нет. Включать `MULTIUSER_ENABLED=1` можно после критериев ниже (живая проверка и наблюдение, которых в песочнице не сделать).

## Повторная проверка W-1..W-6

| # | Итог | Основание |
|---|---|---|
| W-1 | закрыт | `getPsnState` дозаполняет `onboarded_at` при success-запуске своего пользователя (не `hltb`, не чужой). Тесты `me/psn/route.test.ts` (3 кейса). Согласуется с `markOnboarded` в `service.ts`. |
| W-2 | закрыт | Контракт 22.13 приведён к коду (`queue=<userId>`). |
| W-3 | закрыт | Умолчание `LLM_DAILY_LIMIT=60`, предупреждение `llmLimitWarning` при старте обхода; `env-llm-limit.test.ts`. |
| W-4 | закрыт с оговоркой | Правка вне зоны backend (`src/app/(app)/onboarding-guard.ts`) проверена: origin из `getSyncOrigin()`, без него только `localhost`/`127.0.0.1` из `host`, иначе fail-open. Заголовок `x-forwarded-host` не используется. Cookie уходит только на свой origin. Оговорка B-1 ниже. |
| W-5 | закрыт | Для member текст про закрытый профиль, для владельца прежний (`telegram.test.ts`). |
| W-6 | закрыт | `PUT /api/me/psn`: ник из `PSN_TARGET_ONLINE_ID` для не-owner = 409 `psn_id_taken`, без учёта регистра; владельцу можно. |

## Что проверено

1. Изоляция. Уже были: `user-isolation.test.ts`, `user-isolation-diff.test.ts` (функции и 8 роутов), статический скан `user-scope.test.ts`. Добавлено `src/server/qa-phase-20-5.test.ts` (53 теста, PGlite): (а) каждый `route.ts` (кроме публичных auth) без cookie даёт 401 по всем методам и до БД не доходит (роут без проверки сессии сделает тест красным); (б) поддельная подпись, cookie v:1, мусор = 401; (в) 10 мутирующих роутов, которых не было в тестах (duration, status-date, month-exclusions, status-bulk, status-restore, roadmap exclusions/order, recommend dislike), на чужой id игры/копии у пользователя B: все 4xx, данные A не изменены. Мутация «убрать `games.userId` в `setGamesStatusBulk`» ловится (проверено вручную, откачено).
2. Роли. `/api/access/users` и `/api/access/users/{id}` (единственные owner-only): member и «member с подписанным role=owner в cookie» получают 403, владелец остаётся `active`; роль берётся из БД. blocked с валидной подписью = 401. `/api/cron/*` не открываются сессией владельца. Ручной синк member без ника = 409 без запуска. Примечание: в продукте нет API «синк чужих»; синк, копия, восстановление работают только над данными вызывающего (по дизайну), cron идёт по Bearer.
3. Миграции. `src/db/release-sql-chain-0013-0015.test.ts` (PGlite): схема 0000-0012 + 214 игр, 6420 снимков, трофеи; release 0013 -> owner -> 0014 -> 0015, каждый скрипт дважды подряд; схема побайтно равна drizzle-миграциям, данные и счётчики целы, `user_id=1`, `drizzle migrate` ничего не повторяет (16 записей), второй пользователь с теми же `title_id` работает. Нарушенный порядок (0014 без owner, 0015 без 0014) останавливается до изменений. Отдельные `release-sql-0013/14/15.test.ts` зелёные.
4. e2e (`e2e/phase20-5-two-users.spec.ts`, desktop): два браузерных контекста с cookie uid 1 owner и uid 2 member видят каждый только свои игры; у member `/access` = 404; без cookie `/api/games` = 401 и редирект на `/login`; онбординг member с нуля (занятый ник -> `psn_id_taken` -> свой ник -> загрузка -> «Загружено игр»). `onboarding.spec` и `phase20-access.spec` на desktop и mobile: зелёные (75 из 75 в связке).
5. Регрессия: `tsc` и `eslint .` чистые; `vitest run`: 164 файла, 2801 тест зелёные.

## Замечания (minor / info)

- B-1 (minor): guard делает self-fetch на `getSyncOrigin()`. На Vercel это `VERCEL_URL` (адрес деплоя), если нет `SYNC_ORIGIN`. При включённой Deployment Protection ответ будет 401, guard fail-open: member не попадёт в онбординг автоматически (не ловушка, но принудительный редирект не работает). Задать `SYNC_ORIGIN` = боевой домен.
- B-2 (minor): e2e мокает API, поэтому серверная изоляция в браузере не проверяется; её доказывают тесты на PGlite. Серверный fetch guard в e2e не мокается (fail-open), редирект проверен только юнит-тестом.
- B-3 (info): повторный запуск `release-neon-0014.sql` после `0015` падает (`psn_profile.id` уже удалён). Скрипты рассчитаны на применение по порядку; каждый идемпотентен относительно своей версии схемы. Предупредить владельца: не перезапускать старые файлы.
- B-4 (info): счётчики RAWG/HLTB по пользователям не разделены (нужна `provider_usage`), открыто с 20.4; один пользователь может выбрать общий бесплатный лимит.
- Открыто с 20.4, не относится к коду: Groq `model_not_found`, `psn_access_status='ok'` и ник владельца = `PSN_TARGET_ONLINE_ID` (запрос R-1), `SYNC_ORIGIN` и `CRON_SECRET` в Vercel.

## Не проверено

- Живой второй аккаунт PSN: реальный `psn_private`/`psn_friend_required`, дружба с техаккаунтом, лимиты PSN при двух пользователях подряд.
- Реальные Neon (применение SQL в Neon SQL Editor, а не PGlite), Vercel cron с самовызовом `?queue=`, длительность обхода N пользователей против лимита функции.
- Telegram, Groq, RAWG, Google OAuth на боевом домене: только моки.
- Sandbox/preview-развёртывание; mobile-вариант нового e2e (сознательно пропущен, раскладку онбординга на mobile покрывает `onboarding.spec`).
- Полный e2e (все спеки desktop+mobile) не гонялся.

## Критерии для `MULTIUSER_ENABLED=1`

1. Neon: владелец `role='owner'`, `status='active'`, `psn_access_status='ok'`, `psn_online_id` = `PSN_TARGET_ONLINE_ID` (запрос R-1 из `phase-20-4.md`).
2. В Vercel заданы `SYNC_ORIGIN` (боевой домен), `CRON_SECRET`, `LLM_DAILY_LIMIT` не меньше `число_пользователей x 12`.
3. Живая проверка со вторым аккаунтом PSN: приглашение, вход, онбординг до «Готово», у участника своя коллекция, чужих игр нет, владелец после этого видит свои 214 игр без изменений.
4. Минимум одни сутки наблюдения после включения: ночной обход синкает обоих (`sync_runs` по двум `user_id`), watchdog без ложных алертов, `/api/health` ok.
5. Блокировка и удаление тестового участника с проверкой, что данные владельца не тронуты.
6. Зелёные `tsc`, `eslint`, `vitest`, `e2e/onboarding`, `e2e/phase20-access`, `src/server/qa-phase-20-5.test.ts`.
