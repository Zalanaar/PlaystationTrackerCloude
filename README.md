# PS Tracker

Трекер игр PlayStation: ежедневный синк с PSN (игры, часы, трофеи), коллекция со статусами, бэклог и план на год,
статистика, итоги года. Интерфейс на русском, вход по белому списку (Google) и аварийный пароль владельца.

Стек: Next.js (App Router) + TypeScript, Postgres (Neon) + Drizzle, Vercel (Hobby, автодеплой `main`), Vitest + Playwright.

## Запуск

```bash
nvm use            # Node из .nvmrc (22)
npm ci
cp .env.example .env   # заполнить значения (секреты не коммитить)
npm run dev        # http://localhost:3000
```

## Проверки

| Команда | Что |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint, `tsc --noEmit` |
| `npm test` | Vitest (БД на PGlite, сеть не нужна) |
| `npm run e2e` | Playwright (chromium desktop + mobile; WebKit iPhone — проект `webkit-iphone`) |
| `npm run e2e:pwa` | PWA на production-сборке |

CI (`.github/workflows/ci.yml`) гоняет всё это на каждый push в `main` и PR. Миграции БД применяет CI (`db-plan` → `db-migrate`):
агент или разработчик меняет `src/db/schema.ts`, запускает `npm run db:generate` и коммитит миграцию; только expand-миграции.

## Где что

- `CLAUDE.md` — решения, правила кода и процесса; `plan.md` — фазы.
- `docs/api-contract.md` — API и схема, `docs/design-system.md` — UI и токены.
- `src/app` страницы и API-роуты, `src/server` логика (PSN, синк, статистика), `src/db` схема и миграции, `src/ui` компоненты.
- `public/sw.js` — service worker; после правки: `node scripts/sw-version.mjs --write` (версия кэша = хэш файла).
