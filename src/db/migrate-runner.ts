// Применение drizzle-миграций из CI (Фаза 46). Совместим с журналом drizzle.__drizzle_migrations (hash = sha256 файла, created_at = when из _journal.json),
// который вели release-neon-*.sql для 0000–0027. В отличие от стандартного мигратора drizzle (одна транзакция на все и только сравнение с последним created_at):
// - сверяет журнал базы с репозиторием (пропущенные, лишние, изменённые миграции = ошибка, а не тихий пропуск);
// - каждая миграция в своей транзакции (ADD VALUE enum в одной миграции и его использование в следующей не конфликтуют);
// - миграция с потерей данных применяется только с пометкой `-- DATA LOSS: ...` и явным разрешением (approve в GitHub).
// Без env, сети и Next: клиент передаётся снаружи (Neon Pool в CI, PGlite в тестах).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Последняя миграция, применённая вручную через release-neon-*.sql: расхождение хеша до неё включительно = предупреждение, после = ошибка. */
export const LEGACY_LAST_IDX = 27;

export type SqlClient = {
  /** Один запрос с параметрами. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Сырой SQL без параметров (может содержать несколько операторов). */
  run(text: string): Promise<void>;
};

export type Migration = { idx: number; tag: string; when: number; hash: string; raw: string; statements: string[]; dataLoss: string | null; noTransaction: boolean };
export type AppliedRow = { hash: string; created_at: number };
export type Inspection = { applied: AppliedRow[]; pending: Migration[]; errors: string[]; warnings: string[]; destructive: Migration[] };

const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+COLUMN\s+"?[\w]+"?\s+(SET\s+DATA\s+)?TYPE\b/i,
  /\bRENAME\s+(TO|COLUMN)\b/i,
];

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

export function destructiveStatements(raw: string): string[] {
  return stripComments(raw)
    .split('--> statement-breakpoint')
    .flatMap((s) => s.split(/;\s*\n/))
    .map((s) => s.trim())
    .filter((s) => s && DESTRUCTIVE.some((re) => re.test(s)));
}

export function loadMigrations(folder: string): Migration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] };
  return journal.entries.map((e) => {
    const raw = readFileSync(join(folder, `${e.tag}.sql`), 'utf8');
    const dl = /^--\s*DATA LOSS:\s*(.+)$/m.exec(raw);
    return {
      idx: e.idx,
      tag: e.tag,
      when: e.when,
      hash: createHash('sha256').update(raw).digest('hex'),
      raw,
      statements: raw.split('--> statement-breakpoint').filter((s) => s.trim()),
      dataLoss: dl ? dl[1].trim() : null,
      noTransaction: /^--\s*migrate:no-transaction\b/m.test(raw),
    };
  });
}

/** Ошибки самого журнала репозитория (без базы): порядок, уникальность, пометки DATA LOSS у новых миграций. */
export function checkJournal(migrations: Migration[]): string[] {
  const errors: string[] = [];
  migrations.forEach((m, i) => {
    if (m.idx !== i) errors.push(`${m.tag}: idx ${m.idx}, ожидался ${i}`);
    if (i > 0 && m.when <= migrations[i - 1].when) errors.push(`${m.tag}: when ${m.when} не больше предыдущего (${migrations[i - 1].tag}); мигратор её тихо пропустит. Пересоздайте миграцию поверх свежего main`);
    if (!m.tag.startsWith(String(m.idx).padStart(4, '0'))) errors.push(`${m.tag}: номер в имени не совпадает с idx ${m.idx}`);
    if (m.idx > LEGACY_LAST_IDX && destructiveStatements(m.raw).length > 0 && !m.dataLoss) {
      errors.push(`${m.tag}: есть удаляющие операторы (${destructiveStatements(m.raw)[0].slice(0, 60)}…), но нет строки «-- DATA LOSS: <что теряется>»`);
    }
  });
  return errors;
}

export async function ensureJournalTable(c: SqlClient): Promise<void> {
  await c.run('CREATE SCHEMA IF NOT EXISTS drizzle');
  await c.run('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
}

async function readApplied(c: SqlClient): Promise<AppliedRow[]> {
  const exists = await c.query<{ ok: boolean }>(`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`);
  if (!exists.rows[0]?.ok) return [];
  const r = await c.query<{ hash: string; created_at: string | number }>('select hash, created_at from drizzle.__drizzle_migrations order by created_at, id');
  return r.rows.map((x) => ({ hash: x.hash, created_at: Number(x.created_at) }));
}

/** Только чтение: что применено, что ждёт, что не так. */
export async function inspect(c: SqlClient, migrations: Migration[]): Promise<Inspection> {
  const errors = checkJournal(migrations);
  const warnings: string[] = [];
  const applied = await readApplied(c);
  const byWhen = new Map(migrations.map((m) => [m.when, m]));
  const seen = new Set<number>();
  for (const row of applied) {
    if (seen.has(row.created_at)) errors.push(`журнал базы: дубль created_at ${row.created_at}`);
    seen.add(row.created_at);
    const m = byWhen.get(row.created_at);
    if (!m) {
      errors.push(`в базе применена миграция created_at=${row.created_at}, которой нет в репозитории (код старее базы?)`);
      continue;
    }
    if (m.hash !== row.hash) {
      const msg = `${m.tag}: хеш в базе ${row.hash.slice(0, 12)}… не совпадает с файлом ${m.hash.slice(0, 12)}… (файл изменён после применения)`;
      if (m.idx <= LEGACY_LAST_IDX) warnings.push(msg);
      else errors.push(msg);
    }
  }
  const maxApplied = applied.reduce((a, r) => Math.max(a, r.created_at), -Infinity);
  for (const m of migrations) {
    if (m.when <= maxApplied && !seen.has(m.when)) errors.push(`${m.tag}: не применена, но старше последней применённой; стандартный мигратор её пропустил бы`);
  }
  const pending = migrations.filter((m) => m.when > maxApplied);
  return { applied, pending, errors, warnings, destructive: pending.filter((m) => m.idx > LEGACY_LAST_IDX && destructiveStatements(m.raw).length > 0) };
}

/** SQL на ревью: ровно то, что будет выполнено, по миграциям. */
export function renderPlan(pending: Migration[]): string {
  if (pending.length === 0) return '-- Нет ожидающих миграций.\n';
  return pending
    .map((m) => [`-- ===== ${m.tag} (when ${m.when}, sha256 ${m.hash})${m.dataLoss ? `\n-- DATA LOSS: ${m.dataLoss}` : ''}${m.noTransaction ? '\n-- без транзакции' : ''}`, ...m.statements.map((s) => s.trim() + (s.trim().endsWith(';') ? '' : ';')), `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${m.hash}', ${m.when});`].join('\n'))
    .join('\n\n') + '\n';
}

export type ApplyOptions = { allowDataLoss?: boolean; lockTimeout?: string; statementTimeout?: string; log?: (s: string) => void };

/** Применяет ожидающие миграции по одной, каждую в своей транзакции. Сначала полная проверка: при любой ошибке ничего не выполняется. */
export async function applyPending(c: SqlClient, migrations: Migration[], opts: ApplyOptions = {}): Promise<Migration[]> {
  const log = opts.log ?? (() => undefined);
  const lock = await c.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtext('ptc:migrations')) as ok`);
  if (!lock.rows[0]?.ok) throw new Error('другой процесс уже применяет миграции (advisory lock занят)');
  try {
    const ins = await inspect(c, migrations);
    if (ins.errors.length) throw new Error(`проверка журнала не прошла:\n- ${ins.errors.join('\n- ')}`);
    const unapproved = ins.destructive.filter((m) => !m.dataLoss || !opts.allowDataLoss);
    if (unapproved.length) throw new Error(`миграции с потерей данных без разрешения: ${unapproved.map((m) => m.tag).join(', ')}`);
    await ensureJournalTable(c);
    const done: Migration[] = [];
    for (const m of ins.pending) {
      log(`применяю ${m.tag}`);
      const insert = `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${m.hash}', ${m.when})`;
      if (m.noTransaction) {
        for (const s of m.statements) await c.run(s);
        await c.run(insert);
      } else {
        await c.run('BEGIN');
        try {
          await c.run(`SET LOCAL lock_timeout = '${opts.lockTimeout ?? '10s'}'`);
          await c.run(`SET LOCAL statement_timeout = '${opts.statementTimeout ?? '5min'}'`);
          for (const s of m.statements) await c.run(s);
          await c.run(insert);
          await c.run('COMMIT');
        } catch (e) {
          await c.run('ROLLBACK').catch(() => undefined);
          throw new Error(`${m.tag} не применена (откат транзакции): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      done.push(m);
    }
    return done;
  } finally {
    await c.query(`select pg_advisory_unlock(hashtext('ptc:migrations'))`).catch(() => undefined);
  }
}

/** Отпечаток схемы public: колонки, ограничения, индексы, enum. Сравнивается с чистой базой после всех миграций (дрейф прода). */
export async function schemaFingerprint(c: SqlClient): Promise<string[]> {
  const q = async (sql: string) => (await c.query<{ s: string }>(sql)).rows.map((r) => r.s);
  return [
    ...(await q(`select 'col '||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`)),
    ...(await q(`select 'con '||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`)),
    ...(await q(`select 'idx '||indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`)),
    ...(await q(`select 'enum '||t.typname||':'||string_agg(e.enumlabel, ',' order by e.enumsortorder) as s from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname order by 1`)),
  ];
}

export function diffFingerprints(expected: string[], actual: string[]): { missing: string[]; extra: string[] } {
  const a = new Set(actual);
  const e = new Set(expected);
  return { missing: expected.filter((x) => !a.has(x)), extra: actual.filter((x) => !e.has(x)) };
}
