// CLI миграций для CI (Фаза 46). Строка подключения только из env MIGRATE_DATABASE_URL (owner, без pooler); никогда не печатается.
//   status            только чтение: журнал базы против репозитория, ожидающие миграции (exit 1 при ошибках журнала)
//   plan <file>       только чтение: SQL ожидающих миграций в файл (артефакт на ревью)
//   apply             применить ожидающие (MIGRATE_ALLOW_DATA_LOSS=1 разрешает миграции с «-- DATA LOSS:»)
//   verify            после apply: ожидающих нет, схема public совпадает с чистой базой после всех миграций (PGlite)
// MIGRATE_DATABASE_URL=pglite:<dir> или pglite:memory — локальная проверка без Neon.
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { applyPending, diffFingerprints, inspect, loadMigrations, renderPlan, schemaFingerprint, type SqlClient } from '../src/db/migrate-runner';

const folder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

function pgliteClient(db: PGlite): SqlClient {
  return {
    query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await db.query<T>(text, params)).rows }),
    run: async (text: string) => {
      await db.exec(text);
    },
  };
}

async function connect(): Promise<{ client: SqlClient; close: () => Promise<void> }> {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL не задан');
  if (url.startsWith('pglite:')) {
    const dir = url.slice('pglite:'.length);
    const db = new PGlite(dir === 'memory' ? undefined : dir);
    return { client: pgliteClient(db), close: () => db.close() };
  }
  if (url.includes('-pooler.')) throw new Error('нужна прямая (unpooled) строка подключения: pooler не держит advisory lock и сессию');
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString: url, max: 1 });
  const conn = await pool.connect();
  return {
    client: {
      query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await conn.query(text, params)).rows as T[] }),
      run: async (text: string) => {
        await conn.query(text);
      },
    },
    close: async () => {
      conn.release();
      await pool.end();
    },
  };
}

function output(key: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
function summary(md: string) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const label = process.env.MIGRATE_TARGET_LABEL ?? 'база';
  const migrations = loadMigrations(folder);
  const { client, close } = await connect();
  try {
    const ins = await inspect(client, migrations);
    for (const w of ins.warnings) console.log(`::warning::${w}`);
    for (const e of ins.errors) console.log(`::error::${e}`);
    output('pending', String(ins.pending.length));
    output('data_loss', ins.destructive.length > 0 ? 'true' : 'false');
    const pendingList = ins.pending.map((m) => `${m.tag}${m.dataLoss ? ` (DATA LOSS: ${m.dataLoss})` : ''}`);
    console.log(`${label}: применено ${ins.applied.length}, ожидают ${ins.pending.length}${pendingList.length ? `: ${pendingList.join(', ')}` : ''}`);
    if (cmd === 'status') {
      summary(`### Миграции (${label})\nПрименено: ${ins.applied.length}. Ожидают: ${ins.pending.length}${pendingList.map((t) => `\n- ${t}`).join('')}`);
      if (ins.errors.length) process.exitCode = 1;
    } else if (cmd === 'plan') {
      if (!arg) throw new Error('plan <file>');
      writeFileSync(arg, renderPlan(ins.pending));
      if (ins.errors.length) process.exitCode = 1;
    } else if (cmd === 'apply') {
      const done = await applyPending(client, migrations, { allowDataLoss: process.env.MIGRATE_ALLOW_DATA_LOSS === '1', log: (s) => console.log(s) });
      summary(`### Применено (${label}): ${done.length}${done.map((m) => `\n- ${m.tag}`).join('')}`);
    } else if (cmd === 'verify') {
      if (ins.pending.length || ins.errors.length) throw new Error(`после apply: ожидают ${ins.pending.length}, ошибок ${ins.errors.length}`);
      const ref = new PGlite();
      const refClient = pgliteClient(ref);
      await applyPending(refClient, migrations, { allowDataLoss: true });
      const d = diffFingerprints(await schemaFingerprint(refClient), await schemaFingerprint(client));
      await ref.close();
      if (d.missing.length || d.extra.length) {
        const lines = [...d.missing.map((x) => `- нет в ${label}: ${x}`), ...d.extra.map((x) => `+ лишнее в ${label}: ${x}`)];
        summary(`### Дрейф схемы (${label})\n\`\`\`\n${lines.join('\n')}\n\`\`\``);
        console.log(lines.join('\n'));
        if (process.env.MIGRATE_SCHEMA_DRIFT !== 'warn') throw new Error(`схема ${label} отличается от миграций (${lines.length} расхождений)`);
        console.log('::warning::дрейф схемы допущен (MIGRATE_SCHEMA_DRIFT=warn)');
      } else console.log(`${label}: схема совпадает с миграциями`);
    } else throw new Error('команда: status | plan <file> | apply | verify');
  } finally {
    await close();
  }
}

main().catch((e: unknown) => {
  // сообщение без строки подключения: она не попадает в ошибки драйвера, но на всякий случай вырезаем
  const msg = (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/g, '<url>');
  console.error(`::error::${msg}`);
  process.exit(1);
});
