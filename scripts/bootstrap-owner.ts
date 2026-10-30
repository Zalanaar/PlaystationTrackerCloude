// Запуск: npm run db:bootstrap-owner (читает .env). Идемпотентно вставляет owner из OWNER_EMAIL (контракт 22.7, шаг 2).
// Требует применённой миграции 0013. Email и строка подключения не выводятся.
import { getDb } from "../src/db";
import { normalizeEmail, runBootstrapOwner } from "../src/server/auth/users";

async function main(): Promise<number> {
  const email = normalizeEmail(process.env.OWNER_EMAIL);
  if (!email) {
    console.error("OWNER_EMAIL не задан или не похож на email.");
    return 1;
  }
  const db = getDb();
  const online = process.env.PSN_TARGET_ONLINE_ID?.trim() || null;
  const r = await runBootstrapOwner(db, email, online);
  (r.code === 0 ? console.log : console.error)(r.message);
  return r.code;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error("bootstrap-owner не удался:", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    process.exit(1);
  },
);
