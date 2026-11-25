// t282u (П.2): главная снова без сворачиваемого «Сегодня» — профиль в шапке и «Играю сейчас» крупно.
// От «Сегодня» остались: «Разбор N» в шапке (П.3) и 1–2 подсказки статусов (П.10, статус меняется вручную в окне игры).
import { test, expect } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

test('главная: «Играю сейчас» видно сразу, строки «Сегодня» нет; «Разбор N» и подсказки статусов', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  const m = await mockApi(page);
  m.hints = [
    { gameId: 6, rule: 'started', currentStatus: 'backlog' },
    { gameId: 1, rule: 'stale', currentStatus: 'playing' },
    { gameId: 2, rule: 'started', currentStatus: null },
  ];
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Играю сейчас' })).toBeVisible();
  await expect(page.getByTestId('today-toggle')).toHaveCount(0);
  await expect(page.getByTestId('playing-strip')).toHaveCount(0);
  const tri = page.getByTestId('today-triage');
  await expect(tri).toBeVisible();
  await expect(tri).toHaveAttribute('href', '/triage');
  await expect(tri).toContainText(/Разбор\s*\d+/);
  expect((await tri.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const hints = page.getByTestId('today-hint');
  await expect(hints).toHaveCount(2);
  await expect(page.getByTestId('today-hints')).toContainText('Все подсказки: 3');
  const before = m.mutations.length;
  await hints.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(m.mutations.length).toBe(before);
});
