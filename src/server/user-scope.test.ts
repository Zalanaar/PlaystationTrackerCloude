// Охранный тест изоляции (контракт 22.6, 22.12): исходники, которые трогают user-scoped таблицы, обязаны работать с userId.
// Статический скан: ловит файл, где забыли про userId целиком. Построчную полноту проверяют тесты утечек (user-isolation.test.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** Таблицы с колонкой user_id (контракт 22.1, миграция 0014). */
const USER_TABLES = [
  'games', 'gameStatus', 'trophySets', 'gameTrophySets', 'trophies', 'playtimeSnapshots', 'syncRuns', 'psnProfile', 'statusBackups',
  'gameMonthExclusions', 'roadmapSettings', 'plannedGames', 'roadmapOrder', 'roadmapExcluded', 'recommendDislikes', 'recommendReasons',
  'recommendLlmUsage', 'recommendDiscoverCache', 'recommendExternalDislikes', 'providerUsage',
];

/** Модули, которым userId не нужен, и почему. Новые записи только с причиной. */
const ALLOW: Record<string, string> = {
  'server/psn/auth.ts': 'psn_auth: глобальный технический токен',
  'server/psn/errors.ts': 'только тип enum',
  'server/auth/attempts.ts': 'login_attempts: глобальная, до входа',
  'server/collection/duration.ts': 'только SQL-фрагменты колонок games без запросов',
  'server/sync/test-helpers.ts': 'хелпер тестов (TRUNCATE и фейковый PSN)',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Имена таблиц, которые файл берёт из schema (деструктуризация или schema.x). */
function usedTables(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*schema\s*;/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(':')[0].trim();
      if (n) names.add(n);
    }
  }
  for (const m of src.matchAll(/\bschema\.([A-Za-z]+)/g)) names.add(m[1]);
  return [...names].filter((n) => USER_TABLES.includes(n));
}

describe('охрана изоляции пользователей (статический скан)', () => {
  const files = [...walk(join(SRC, 'server')), ...walk(join(SRC, 'app'))];

  it('скан находит исходники и таблицы (проверка, что тест не пустой)', () => {
    expect(files.length).toBeGreaterThan(80);
    const touching = files.filter((f) => usedTables(readFileSync(f, 'utf8')).length > 0);
    expect(touching.length).toBeGreaterThan(25); // было 30: модуль «Новое от ИИ» удалён 2026-10-31
  });

  it('каждый файл с user-scoped таблицами содержит userId (кроме allowlist с причиной)', () => {
    const bad: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (ALLOW[rel]) continue;
      const src = readFileSync(f, 'utf8');
      const tables = usedTables(src);
      if (tables.length === 0) continue;
      if (!/\buserId\b|\buser_id\b/.test(src)) bad.push(`${rel}: ${tables.join(', ')}`);
    }
    expect(bad, 'файлы с user-scoped таблицами без userId').toEqual([]);
  });

  it('allowlist не содержит устаревших записей', () => {
    for (const rel of Object.keys(ALLOW)) {
      expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
    }
  });

  it('SQL-запросы по голым именам таблиц (db.execute) тоже упоминают user_id', () => {
    const bad: string[] = [];
    const tableSql = /\b(?:from|join|into|update)\s+(games|game_status|trophy_sets|game_trophy_sets|trophies|playtime_snapshots|sync_runs|psn_profile|status_backups|game_month_exclusions|roadmap_settings|planned_games|roadmap_order|roadmap_excluded|recommend_dislikes|recommend_reasons|recommend_llm_usage|provider_usage|recommend_discover_cache|recommend_external_dislikes)\b/i;
    for (const f of files) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (ALLOW[rel] || rel === 'server/sync/test-helpers.ts') continue;
      const src = readFileSync(f, 'utf8');
      // только raw-SQL внутри sql`...`: ищем в шаблонных строках
      for (const m of src.matchAll(/sql`([^`]*)`/g)) {
        if (tableSql.test(m[1]) && !/user_id/.test(src)) bad.push(rel);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
