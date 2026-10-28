// QA Фаз 9-10: краевые случаи чипа «Платина» на большой коллекции. API эмулируется (collection-mock.ts).
import { test, expect } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const BIG = 350;
// 350 игр без статуса; платина у каждой 10-й (35 штук), равномерно по всему списку, включая хвост
const bigSet = (): G[] =>
  Array.from({ length: BIG }, (_, i) => ({
    id: 1000 + i, title: `Игра ${String(i).padStart(3, '0')}`, lastPlayedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString(),
    status: null, completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1,
    trophies: { earned: 20, defined: 30, plat: i % 10 === 9 },
  }));

test.describe('Чип «Платина» при >300 игр', () => {
  // BUG-P9-1 (frontend): открыт. Сейчас на экране 6 из 35, кнопка «Показать ещё (290)» считает игры сервера. Убрать test.fail после исправления.
  test.fail('плоский вид (sort=title): все 35 платин должны быть найдены, а не только из первых 60', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, bigSet());
    await page.goto('/?sort=title&platinum=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Платина: 35/ })).toBeVisible();
    await page.waitForTimeout(1500);
    const shown = await page.locator('section[aria-labelledby="coll-title"] article.ps-card').count();
    // ожидание по плану 9.1: чип показывает все игры с платиной (35), счёт на чипе = число карточек
    expect(shown).toBe(35);
  });
});
