// Главная без дублей запросов на загрузке: /api/auth/me, /api/me/tour, сводка и блоки хроники уходят по одному разу.
// Раньше: auth/me ×3 (три хука), tour ×2 (тур и «Что нового»), summary и /api/games ×2 (первый ответ статуса синка принимался за «синк завершился»).
import { test, expect } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

test('коллекция: каждый запрос данных на загрузке один раз', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page);
  const calls: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.method() === 'GET') calls.push(u.pathname + u.search); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  await expect.poll(() => calls.filter((c) => c.startsWith('/api/inbox')).length).toBeGreaterThan(0);
  await page.waitForTimeout(1500); // поздние дубли (перечитывание после статуса синка) пришли бы в это окно
  const count = (p: string) => calls.filter((c) => c === p || c.startsWith(`${p}?`)).length;
  expect(count('/api/auth/me'), calls.join('\n')).toBe(1);
  expect(count('/api/me/tour'), calls.join('\n')).toBe(1);
  expect(count('/api/collection/summary'), calls.join('\n')).toBe(1);
  const games = calls.filter((c) => c.startsWith('/api/games?'));
  expect(new Set(games).size, calls.join('\n')).toBe(games.length);
});
