// П.7/П.19 (t281u): в «Обзоре» нет денег; сверху оценка и дневник, «История» и «Подробнее» свёрнуты, раскрытие запоминается.
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

test('«Обзор»: оценка и дневник сверху, история и подробности свёрнуты, без цен', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  const m = await mockApi(page, seed());
  const week = (weekStart: string, seconds = 0) => ({ weekStart, seconds, estimatedSeconds: 0, trophies: 0, platinum: false });
  m.histories[1] = { weeks: [week('2026-05-04', 7200), week('2026-05-11', 3600)], truncated: false, hasHours: true, hasEstimate: false, playedDays: 3, firstSnapshotDate: '2026-05-01' };
  await page.addInitScript(() => localStorage.setItem('ps-gd-folds', '{}'));
  await page.goto('/?game=1');
  const d = page.getByRole('dialog', { name: 'The Witcher 3: Wild Hunt' });
  await expect(d).toBeVisible();
  const more = d.getByTestId('gd-fold-more').getByRole('button', { name: /Подробнее/ });
  const hist = d.getByTestId('gd-fold-history').getByRole('button', { name: 'История' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(hist).toHaveAttribute('aria-expanded', 'false');
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(d.getByRole('button', { name: 'Сбросить статус' })).toHaveCount(0);
  await expect(d.getByTestId('game-history')).toHaveCount(0);
  await expect(d.getByText(/₽|Цена покупки|Стоимость часа/)).toHaveCount(0);
  // оценка выше свёрнутой истории
  const review = d.locator('.ps-gd__ovmain > *').first();
  expect(await review.evaluate((e) => e.closest('[data-testid="gd-fold-history"]') === null)).toBe(true);
  const rb = (await review.boundingBox())!;
  const hb = (await hist.boundingBox())!;
  expect(rb.y).toBeLessThan(hb.y);
  await more.click();
  await expect(d.getByRole('button', { name: 'Сбросить статус' })).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Даты' })).toBeVisible();
  await hist.click();
  await expect(d.getByTestId('game-history')).toBeVisible();
  // запоминается
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ps-gd-folds') ?? '{}'))).toEqual({ more: true, history: true });
});
