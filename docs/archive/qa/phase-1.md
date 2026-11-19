# QA: приёмка Фазы 1 (Основа)

Дата: 2026-10-27. Проверено по состоянию кода в рабочей копии.

## Вердикт

**Принято по коду, фаза не закрыта.** Критических и блокирующих багов в коде нет. Пункт приёмки «пустой закрытый сайт открывается на Vercel, миграции применяются» без Vercel и Neon не проверить. **Блокер на стороне Артёма:** создать проект Vercel и базу Neon, задать env (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET` и др.), применить `npm run db:migrate`. После этого нужен короткий прогон: `/` редиректит на `/login`, вход работает, `/api/health` отдаёт 200 под сессией, cron с Bearer отдаёт 200.

## Критерии

| # | Критерий | Результат |
|---|---|---|
| 1 | `npm run build` | OK (маршруты: /, /login, 4 API, Proxy) |
| 2 | `npm run lint` | OK |
| 3 | `npm run typecheck` | OK |
| 4 | `npm run psn:typecheck` | OK |
| 5 | `npm test` | OK, 132 теста (было 19; добавлены proxy и контраст) |
| 6 | `npm run e2e` | OK, 26 тестов (desktop и mobile Pixel 7) |
| 7 | Схема `schema.ts` и `0000_init.sql` против `api-contract.md` | OK: 9 таблиц, 6 enum, все CHECK, уникальности и частичные индексы совпадают с разделом 1. `drizzle-kit check` чисто |
| 8 | Миграция применяется | OK на PGlite (Postgres 17 в WASM, вне репозитория). Применена целиком, 9 таблиц, 25 индексов. Проверено поведением: дубль `title_id`, плохая `category`, `completed_at` при другом статусе, `dropped_at` при другом статусе, `progress` > 100, `earned_at` при `earned=false`, дубль трофея, дубль снимка `(game_id, snapshot_date)`, второй `running` в `sync_runs`, `psn_auth.id=2` отклоняются; каскад удаления игры чистит `game_status` и снимки. На Neon не проверено |
| 9 | Auth: fail-closed | OK. Нет или короткий `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD` дают 401/редирект/500 `config_error`. Тесты на пустые и короткие секреты |
| 10 | Auth: constant-time | OK. Пароль и Bearer через sha256 и `timingSafeEqual`, подпись через `crypto.subtle.verify` |
| 11 | Auth: лимитер | Логика OK (юнит-тесты на границы 4/5, окно 15 мин, глобальные 20/час, `Retry-After`). SQL в `attempts.ts` без реальной БД не гонялся. См. баг B1 |
| 12 | Открытые пути | OK: `/login`, `/api/auth/login`, `/api/auth/logout`. `/api/cron/*` требует Bearer (сессия не заменяет). `/api/health` закрыт сессией |
| 13 | Флаги cookie | OK: HttpOnly, SameSite=Lax, Path=/, Max-Age 30 суток, Secure кроме localhost. Logout очищает |
| 14 | Open redirect через `next` | OK. `//evil.com`, `/\evil.com`, `https://...`, управляющие символы дают `/`. Тесты юнит и proxy |
| 15 | Проверка Origin и Content-Type | OK для login (чужой Origin и не-JSON дают 400 до проверки пароля). Logout не проверяет, см. B3 |
| 16 | Секреты: логи, ответы, git | OK. Логов в `src/` нет, `probe.ts` санитизирует ошибки, в `.next/static` нет имён секретов, `NEXT_PUBLIC_*` нет, `.env*` в `.gitignore` (кроме `.env.example`), в неотслеживаемых только `.env.example`. `.env` не читал |
| 17 | Контраст 7 тем (порог 4.5, 7 для `accent-ink`) | OK, все пары проходят. Night `--text-3` на `--surface-2` 4.71, Memory 4.76, Dark 4.83; `accent-ink` Memory 10.9. Подробнее ниже |
| 18 | Кириллица шрифта Memory Card | Не OK, см. B2 |
| 19 | Деплой на Vercel, миграции на Neon | Не проверено. Блокер на стороне Артёма |

Контраст: проверка закреплена тестом `src/ui/tokens/contrast.test.ts` (102 проверки, парсит `themes.css` и `tokens.css`). Справочно вне правил: `--text-3` на `--surface-2` Wave 4.70, Tiles 4.59 (проходит, но дизайн-система запрещает там использовать); `--st-dropped` на `--surface-2` Tiles 4.20 (известное ограничение из design-system).

## Добавленные тесты и правки в зоне QA

- `src/proxy.test.ts`: редирект на `/login?next=`, 401 для `/api`, fail-closed без секрета, валидная, просроченная и поддельная cookie (с очисткой), cron Bearer, безопасность `next`, `originAllowed`.
- `src/ui/tokens/contrast.test.ts`: контраст всех тем.
- `e2e/auth.spec.ts`, `e2e/smoke.spec.ts`, `e2e/env.ts`, `e2e/session.ts`: редирект на `/login`, закрытый `/api`, подделанная и просроченная cookie, cron, login (Origin, Content-Type, валидация, fail-closed при недоступной БД), logout. Главная проверяется под подписанной cookie (старый smoke без входа не мог пройти после появления proxy).
- `playwright.config.ts`: dev-серверу передаются тестовые секреты и заведомо недоступный `DATABASE_URL`, `reuseExistingServer: false`, чтобы e2e не использовал чужой сервер и реальную БД. Файл вне `tests/` и `e2e/`, прошу оркестратора принять правку.

## Баги

| ID | Серьёзность | Описание | Шаги |
|---|---|---|---|
| B1 | Средняя | Лимитер входа не атомарен: проверка лимита и запись попытки раздельны, запись идёт после сравнения. Параллельная пачка запросов проходит лимит 5/15 мин (все видят 0 неудач), т.е. перебор пароля обходит защиту. Смягчает пароль от 12 символов. Найдено по коду, запуском не проверено (нужна БД) | 1. Отправить 50 параллельных POST `/api/auth/login` с неверным паролем. 2. Все получают 401, а не 429. Исправление: записывать попытку до сравнения (и снимать при успехе) или брать advisory lock |
| B2 | Низкая | Memory Card: кириллица рисуется системным `ui-monospace`, а не Pixelify Sans. В `layout.tsx` подключён `subsets: ['latin']` и комментарий «кириллицы в next/font нет» неверен: в `font-data.json` Next 16 у Pixelify Sans подсеты `cyrillic, latin, latin-ext` | Включить тему Memory Card, открыть любую страницу с русским текстом. Исправление: `subsets: ['latin','cyrillic']` |
| B3 | Низкая | `/api/auth/logout` не проверяет Origin и Content-Type, хотя контракт 3.4 требует для POST. Сторонний сайт может разлогинить пользователя (SameSite=Lax не защищает кросс-сайтовый fetch без cookie-эффекта, но форма POST с другого сайта cookie не получит; практический вред минимален) | POST `/api/auth/logout` с `Origin: https://evil.example` отдаёт 200 |
| B4 | Низкая (риск на будущее) | Matcher proxy пропускает любой путь с расширением `.png/.jpg/.svg/.ico/.woff...`, а не только файлы из `public/`. Будущий динамический роут вида `/api/x/[id].png` оказался бы открытым | GET `/api/что-угодно.png` не проходит через proxy. Сейчас такого роута нет |

Принятые риски по контракту (не баги): глобальный лимит 20 неудач/час позволяет постороннему на час заблокировать вход владельцу; `/api/auth/login` при недоступной БД отвечает 503 даже с верным паролем (fail-closed).

## Не проверено

- Реальный Vercel и Neon (деплой, env, применение миграций, cron с `CRON_SECRET`).
- Login с настоящей Postgres через драйвер Neon (запись `login_attempts`, 429 по факту).
- Страница `/login` оформлена минимально (по комментарию в коде, дизайн за frontend); сверка с референсом и мобильная вёрстка относятся к Фазе 3.

## Файлы

- `C:\claude\ps-tracker\docs\qa\phase-1.md`
- `C:\claude\ps-tracker\src\proxy.test.ts`
- `C:\claude\ps-tracker\src\ui\tokens\contrast.test.ts`
- `C:\claude\ps-tracker\e2e\auth.spec.ts`, `smoke.spec.ts`, `env.ts`, `session.ts`
- `C:\claude\ps-tracker\playwright.config.ts` (правка)
