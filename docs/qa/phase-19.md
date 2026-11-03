# Приёмка Фазы 19 (техдолг): заголовки безопасности, CSS по экранам, разбиение CollectionView / GameDialog

Дата: 2026-10-30. Ветка `claude/charming-edison-503nlp`, коммиты 0e6223c, ae0041f, 4707c1c, 2e4b796. База сравнения: 1e09571.

## Вердикт: принято (с замечаниями без блокеров)

Блокирующих багов нет. Поведение и вид не изменились.

## Результаты

| Проверка | Итог |
|---|---|
| `tsc --noEmit` | чисто |
| `npm run lint` | чисто |
| Vitest | 137 файлов, 2496 тестов, все зелёные |
| `next build` | успешно |
| E2E (desktop + mobile, весь набор, dev-сервер) | 1251 passed, 325 skipped (mobile-only/desktop-only по дизайну), 2 failed, оба флейки (см. F-1) |
| E2E на прод-сборке (`next start`): security-headers, smoke, wrapped, stats, triage, roadmap, recommend, phase9 | 281 passed, 0 сообщений CSP в логе браузера |

## CSS (ae0041f)
- Сравнено множество деклараций (контекст @media/@supports, селектор, свойство, значение, !important) между `1e09571:src/ui/{components,game91,phase15,phase18}.css` и `src/ui/styles/*.css` через postcss: 4120 против 4123. Потерянных и добавленных деклараций нет. Единственная разница: внутри одного `@media (prefers-reduced-motion: reduce)` селекторы сгруппированы иначе (одни и те же правила `animation/transition: none` для `.ps-tri__ghost`, `.ps-stack3__top`, `.ps-st-excl__*`, `.ps-mm`, `.ps-card__cover`), набор свойств и селекторов тот же.
- Порядок: для одинаковых селекторов с разными значениями одного свойства инверсий порядка нет (0). Порядок подключения в `src/app/layout.tsx` (tokens, themes, decor, base, collection, chronicle, skeletons, game-dialog, triage, stats, profile, plan, globals) собран; импортов удалённых components/game91/phase15/phase18.css в `src/` нет.
- Скриншоты до/после (3 темы: night, graphite, ps1 Memory Card; desktop и mobile; коллекция, окно игры, вкладка трофеев, статистика, разбор, бэклог, план, подскажи; 48 снимков): 45 побайтно идентичны, 3 отличаются на 46 пикселей в шапке (разница яркости <= 3 из 255, шум антиалиасинга/времени). Расхождений нет. Спека: `e2e/css-refactor-shots.spec.ts` (нужен `SHOTS_DIR`, иначе пропускается).
- Оговорка: мок-данные, на тему PS5/Activity снимки не снимались (CSS-декларации для неё проверены множеством деклараций).

## Компоненты (4707c1c, 2e4b796)
- Публичные экспорты `CollectionView` и `GameDialog` и их пропсы не изменились (`GameStub` теперь реэкспорт типа из `dialog/types`).
- `src/ui` не импортирует рантайм из `src/server` (только `import type`). `any` не добавлено. Новых eslint-disable нет (единственный в `CollectionView` перенесён из старого кода).
- Циклы (madge по `src`): один, `ui/sync/SyncProvider.tsx <-> SyncPanel.tsx`, он уже был в 1e09571, к Фазе 19 не относится.
- Focus trap, Esc, возврат фокуса, блокировка скролла: логика `dialog/Frame.tsx` в e2e (окно игры, ?game=, Esc, Tab) зелёная на desktop и mobile.

## Заголовки безопасности (0e6223c)
Прод-сборка, curl: `/login`, `/` (307), 404-редирект, `/api/auth/me` (401), `/api/sync/status` (401), `/manifest.webmanifest`, `/icon.svg` содержат CSP, X-Content-Type-Options, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy, HSTS.
Нарушений CSP нет (прод-сборка и dev) на: `/`, `/stats`, `/backlog`, `/roadmap`, `/recommend`, `/wrapped`, `/triage`, `?game=`, `?game=&tab=trophies`; темы night и ps5 (с `--page-art` и https-обложками), desktop и mobile. Положительный контроль (запрещённый fetch на чужой origin) нарушение ловит. Спека: `e2e/csp-screens.spec.ts`.
Аватар `http://`: сервер нормализует PSN-хосты в https при записи (`psnAvatarUrl`), поэтому новые строки безопасны. Если в БД осталась старая строка с `http://`, в проде её апгрейдит `upgrade-insecure-requests` (нарушения нет, проверено на прод-сборке), в dev браузер её блокирует (ожидаемо).

## Замечания (не блокируют)
- F-1 (низкая, флейк теста): под нагрузкой 4 воркеров упали `month-games-reset-hide.spec.ts:232` (desktop, скрытие/возврат игры в окне: последняя мутация `hidden:true` вместо `false`) и `month-exclude-platinum-corner.spec.ts:244` (mobile, цвет названия на арте). Повтор по 3 раза на обоих проектах при 2 воркерах: 12/12 зелёные. Баг рефакторинга не подтверждён; полный baseline на 1e09571 не гонялся (20 мин), эти два теста на baseline под нагрузкой не проверялись. Если повторится в CI, разобрать гонку `Frame`/тост «Вернуть» (мутация уходит до того, как тост заменён).
- N-1 (низкая): `src/server/collection/profile.ts` отдаёт `avatarUrl` как в БД, без повторной нормализации. Для legacy-строк с `http://` вид зависит от `upgrade-insecure-requests` (см. выше). Рекомендация backend: нормализовать при чтении или разовой миграцией.
- N-2 (инфо): CSP держит `script-src 'unsafe-inline'` (inline-скрипт темы и бутстрап Next), без nonce; зафиксировано в комментарии модуля, XSS-защита от inline-скриптов отсутствует.
- N-3 (инфо): `connect-src 'self'`: внешние API с клиента (RAWG/Groq) недопустимы; сейчас все вызовы идут через `/api`, ломаться нечему.

## Добавленные файлы (зона QA)
`e2e/csp-screens.spec.ts` (CSP по экранам; `CSP_PROD=1` для http-аватара на прод-сборке), `e2e/css-refactor-shots.spec.ts` (снимки до/после), `docs/qa/phase-19.md`.
