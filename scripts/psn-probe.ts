// Запуск: npm run psn:probe  (читает .env через tsx --env-file)
import { runProbe } from "../src/server/psn/probe";

runProbe(process.env, (l) => console.log(l)).then(
  (code) => process.exit(code),
  (e) => {
    console.error("probe crashed:", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    process.exit(1);
  },
);
