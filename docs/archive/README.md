# Архив документации (П15.7)

Старые документы, которые больше не ведутся, но нужны для истории и тестов. Актуальное — в `docs/` (api-contract, design-system, release, design/, plans/roadmap-2026-11.md) и в `plan.md`.

- `release-neon/` — ручные SQL-выкладки на Neon `release-neon-*.sql` (миграции 0001–0027) и их `-check`/`-rollback`. С Фазы 46 миграции применяет CI (`DB migrate (prod)`, `src/db/migrate-runner.ts`); файлы остались как история и как входные данные тестов `src/db/release-sql-*.test.ts`. Ссылки внутри старых файлов и в комментариях миграций указывают на прежний путь `docs/release-neon-*.sql` — это те же файлы, теперь здесь. Содержимое не меняли.
- `qa/` — отчёты QA по фазам (phase-*.md), хвосты (tails-*.md, stage-3-tails.md), test-renames.md. Скриншоты по-прежнему пишутся в `docs/qa/<папка>` (в git не хранятся, см. `docs/qa/README.md`).
- `plans/` — архивы плана по фазам 0–21, аудит 2026-10-29, отзывы по v2.
- `product/` — продуктовое ревью 2026-10-31.
