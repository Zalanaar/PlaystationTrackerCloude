// Запуск: npm run db:bootstrap-owner (читает .env). Идемпотентно вставляет owner из OWNER_EMAIL (контракт 22.7, шаг 2).
// Требует применённой миграции 0013. Email и строка подключения не выводятся.
import { getDb } from "../src/db";
import { bootstrapOwner, getOwner, normalizeEmail } from "../src/server/auth/users";

async function main(): Promise<number> {
  const email = normalizeEmail(process.env.OWNER_EMAIL);
  if (!email) {
    console.error("OWNER_EMAIL не задан или не похож на email.");
    return 1;
  }
  const db = getDb();
  const existing = await getOwner(db);
  if (existing) {
    console.log(`owner уже есть (id=${existing.id}), ничего не меняю.`);
    return 0;
  }
  const online = process.env.PSN_TARGET_ONLINE_ID?.trim() || null;
  const inserted = await bootstrapOwner(db, email, online);
  if (!inserted) {
    console.error("owner не создан: email уже занят другой строкой.");
    return 1;
  }
  const created = await getOwner(db);
  console.log(`owner создан (id=${created?.id}).`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error("bootstrap-owner не удался:", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    process.exit(1);
  },
);
