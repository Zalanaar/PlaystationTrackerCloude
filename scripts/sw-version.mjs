// Версия кэша service worker = хэш содержимого public/sw.js (повторный аудит P2-12): правка файла без смены VERSION
// ловится тестом src/ui/pwa/sw.test.ts. `node scripts/sw-version.mjs --write` проставляет новое значение.
// Не build id: тогда каждый деплой менял бы байты sw.js и показывал «Доступна новая версия» без нужды (статика /_next/static и так с хэшами).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FILE = new URL('../public/sw.js', import.meta.url);
const RE = /var VERSION = '[^']*';/;

export function swContentVersion(src) {
  if (!RE.test(src)) throw new Error('sw.js: нет строки var VERSION');
  return 'c' + createHash('sha256').update(src.replace(RE, "var VERSION = '';")).digest('hex').slice(0, 8);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const src = readFileSync(FILE, 'utf8');
  const v = swContentVersion(src);
  if (process.argv.includes('--write')) writeFileSync(FILE, src.replace(RE, `var VERSION = '${v}';`));
  console.log(v);
}
