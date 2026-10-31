import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...typescript,
  // Фаза 20.3 (контракт 22.12): страницы и UI не ходят в БД напрямую, данные только через API-роуты (с requireUser и userId).
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    ignores: ['src/app/api/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db', '@/db/*', '**/db/schema', '**/db/index'],
              allowTypeImports: true,
              message: 'Прямой доступ к БД из страниц и UI запрещён: данные только через API-роуты (контракт 22.12).',
            },
          ],
        },
      ],
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**', 'coverage/**'] },
];

export default config;
