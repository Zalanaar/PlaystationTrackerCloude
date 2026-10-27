import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'node',
    // PGlite (WASM) стартует 1-8 с на файл при ~35 параллельных воркерах на холодном кэше/загруженной машине; дефолты 5/10 с давали случайные падения.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
