# Приёмка Фазы 20.2 (вход Google, белый список, «Доступ»)

Ветка claude/lucid-cerf-1wqy4c, коммиты c1c50bc…2217017. Дата проверки: 2026-10-30.

## Вердикт

**Принято с замечаниями** при условии `MULTIUSER_ENABLED=0` (как и задумано в 22.7 шаг 3). Блокеров нет. Две «важные» проблемы нужно закрыть: B-1 до мержа (красные e2e), B-2 обязательно до 20.3 / до включения `MULTIUSER_ENABLED=1`.

## Что запускалось

- Vitest `src/server/auth`, `src/ui/access`: 107 из 107 зелёные (PGlite, настоящие SQL и advisory lock).
- Playwright (Chromium из /opt/pw-browsers/chromium, `PW_CHROMIUM_PATH`): `phase20-access` и `auth`: после правки теста 26/26 и 14/14 (desktop + mobile).
- Смоук: smoke, security-headers, collection, sync, stats, qa-phase19-csp: 97 прошло, 53 пропущено (desktop-only блоки на mobile), 6 упало. Все 6 упали на одной причине (B-1).
- Скриншоты `/access` и `/login` на 3 темах (night, ps5, graphite), 1280 и 375 px: вёрстка в порядке, горизонтального скролла нет, статусы читаются, подтверждение удаления и «Аварийный вход» работают. Скриншоты: scratchpad/shots (не в репо).

## Проблемы

| # | Серьёзность | Что | Шаги / доказательство | Чья зона |
|---|---|---|---|---|
| B-1 | важно | `useIsOwner` не дочитывает тело ответа при `!r.ok` (`r.ok ? r.json() : null`). Когда `/api/auth/me` отвечает 503 (в e2e БД недоступна), запрос в Chromium остаётся «не завершён», `networkidle` не наступает. Падают 6 тестов: `security-headers` «страницы грузятся без нарушений CSP» и `qa-phase19-csp` (night, ps5) на desktop и mobile. До 20.2 они проходили. | `npx playwright test e2e/security-headers.spec.ts --project=desktop`. Если замокать `/api/auth/me`, тест зелёный. По событиям: ответ 503 приходит, `requestfinished` не приходит. Причина (непрочитанное тело) вероятная, не доказана отдельно. | frontend: читать/отменять тело (`r.json().catch`, либо `await r.text()`) в `src/ui/access/useIsOwner.ts`. Тесты не менял, чтобы не маскировать |
| B-2 | важно (блокер для 20.3 и для `MULTIUSER_ENABLED=1`) | Блокировка и удаление «мгновенно» (22.3, 22.5) работают только на `/api/auth/me` и `/api/access/*`. Все остальные API (`/api/games`, `/api/backup`, статистика и т.д.) проверяют только подпись cookie в `proxy.ts` и не вызывают `requireUser`. Заблокированный или удалённый пользователь сохраняет доступ к данным до 30 дней, а `member` с валидной сессией видит общую (ещё не user-scoped) коллекцию владельца. Сейчас не воспроизводится: member нельзя создать (`multiuser_not_ready`). | Прямой INSERT member (invited) в БД, вход через Google, затем `GET /api/games` отдаёт коллекцию владельца; после `PATCH status=blocked` тот же запрос продолжает отдавать данные. Это ожидаемо для 20.2, но фиксируем как условие. | backend, 20.3: `requireUser` + scope во всех роутах до включения флага. Добавить в приёмку 20.3 тест «blocked: все роуты 401» |
| B-3 | замечание | Сессия `v:1` трактуется как `uid = 1`. `db:bootstrap-owner` не проверяет, что owner получил `id = 1`. Identity-счётчик в Postgres расходуется и при неудачной вставке (нарушение CHECK/UNIQUE), и при `ON CONFLICT DO NOTHING`. Если первая попытка упала после `nextval`, owner получит `id = 2`; тогда все старые cookie дают 401 (`requireUser` ищет uid 1) либо, если id 1 займёт кто-то другой, принадлежат ему. Влияет на владельца в один заход (перелогиниться). | Теоретически; PGlite-тест `bootstrapOwner идемпотентен` не покрывает сбой первой вставки. | backend: в скрипте после вставки печатать предупреждение/exit 1, если `id <> 1` |
| B-4 | замечание | Выкладка. Порядок 0013 → bootstrap-owner → деплой кода описан в api-contract 22.7 (шаги 1–3), миграция 0013 только добавляет `allowed_users` и `login_attempts.kind` с default (существующие таблицы данных не тронуты, проверено по SQL). Но: если код задеплоить до bootstrap-owner, аварийный вход паролем отвечает 401 `invalid_credentials` (owner-строки нет) и Google тоже не пустит, то есть владелец заперт. Отдельного runbook или предупреждения в `.env.example`/README нет, только таблица в контракте. | Чтение кода `POST /api/auth/login`, `lookupForLogin`. | backend/оркестратор: одна строка-предупреждение «деплой только после bootstrap-owner» рядом с `OWNER_EMAIL` в `.env.example` |
| B-5 | замечание | Время ответа `access_denied` не строго одинаково: ветка «нет в списке» делает 2 SELECT, «есть» ещё UPDATE. Разница миллисекунды на фоне обмена кода с Google (сотни мс), практической утечки нет. | Чтение `callback/route.ts`. | не требует действий |
| B-6 | замечание | `pst_oauth` ставится на хост, с которого начат вход, а `redirect_uri` берётся из `APP_ORIGIN`. Если зайти на www/preview-домен, отличный от `APP_ORIGIN`, callback придёт на другой хост без cookie: `oauth_failed`. Корректный отказ, но неочевидный. | Конфигурация. | docs: напомнить, что `APP_ORIGIN` = единственный боевой домен |
| B-7 | замечание | Два параллельных `GET /api/auth/me` при загрузке страницы (StrictMode, кэш `cached` не защищает от двух запросов в полёте). Лишняя нагрузка, не баг. | Лог запросов Playwright. | frontend (по желанию) |

## Исправлено мной в тестах

- `e2e/phase20-access.spec.ts`: `getByRole('alert')` попадал на 2 элемента (Next route announcer), strict mode давал 3 падения; заменено на `[role=alert]:not(#__next-route-announcer__)`.
- Те же файл: тесты меню профиля падали на mobile, где аватар скрыт и открывается «Меню» (Sheet, пункты без `role=menuitem`). Добавлены `openProfileMenu` / `accessItem` с учётом `isMobile`. Это ошибка теста, не кода: на мобильном пункт «Доступ» в Sheet есть (виден на скриншоте-ветке кода AppShell и проверен тестом).

## Ревью безопасности по §22: результат

Подтверждено кодом и тестами, дефектов нет:
- PKCE S256, state 32 байта, nonce, verifier; сравнение state и nonce через `secureEqual`; `pst_oauth` подписана, имеет тип `t:'oauth'` (нельзя подменить сессионной cookie), одноразовая (сбрасывается при любом исходе), Path=/api/auth/google, 600 с.
- `id_token`: RS256 по JWKS (kid, повторная загрузка при ротации), отклоняет alg none/HS256, проверяет iss, aud (строка или массив из одного), exp, nonce, `email_verified`.
- Единый отказ `access_denied` для: нет в списке, blocked, чужой sub, неподтверждённый email; протокольные ошибки дают `oauth_failed`. В редиректах, ответах и коде нет `console.*` и email/токенов.
- Лимиты: kind='google' (10/15 мин IP, 40/час глобально) отдельно от пароля; callback резервирует попытку под advisory lock, снимает после выдачи сессии; старт только проверяет; 429 не продлевает блокировку.
- Роль и статус берутся из БД (`requireUser`); cookie с `role=owner` у member остаётся member; `v:1` не проходит при отсутствующем/заблокированном owner (покрыто тестами).
- `owner_protected`: нельзя заблокировать/удалить owner и себя; CHECK в БД запрещает blocked owner; единственный owner через partial unique.
- MAX_USERS: create и unblock под `pg_advisory_xact_lock`, тест на параллельные POST; blocked в лимит не входит.
- Open redirect: `safeNext` режет `//`, `/\`, схемы, управляющие символы; применяется на старте, в cookie, в callback, в password-login и в proxy; клиент `next` в навигацию напрямую не подставляет.
- CSRF: мутации `/api/access/*` требуют JSON Content-Type и совпадающий Origin (при пустом Origin остаётся защита типом контента и SameSite=Lax); логин и логаут так же.
- Секреты: `client_secret` только в серверном запросе обмена; токены Google не сохраняются.

## Сверка с контрактом

Формы ответов и коды (`/api/auth/me`, `/api/access/users`, 201 на POST, `{ user }` на PATCH, `{ deleted: true }`, 409 `user_exists|user_limit|owner_protected|not_blocked|multiuser_not_ready`, 400 `confirm_mismatch`, 404, 403) совпадают с 22.4, 22.5, 22.10. Расхождений нет. Отклонение по смыслу одно (B-2).

## Не проверено

- Реальный Google OAuth (консоль Google, redirect_uri, реальные JWKS): только юнит-тесты с подставленными ключами.
- Реальная Neon: транзакции и advisory lock проверены на PGlite; поведение через пул Neon в проде не проверялось.
- Реальная миграция 0013 на копии прод-БД; просмотрен только SQL (аддитивный).
- `Retry-After` и лимиты по IP за прокси Vercel (доверие к первому `x-forwarded-for`).
- Темы memory card, crystal towers, tiles и др. (проверены 3 из доступных), полный прогон всех e2e (прогнан выборочно).
- Скриншоты `/login` на всех темах (проверена одна: graphite, 375 px).
