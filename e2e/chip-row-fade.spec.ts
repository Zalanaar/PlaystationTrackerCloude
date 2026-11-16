// П9 «Удобство»: ряды чипов с прокруткой — тень у края, за которым есть ещё чипы, и прокрутка к выбранному чипу.
// Телефон 390 px (Pixel 7 и WebKit iPhone); на десктопе ряд помещается целиком — тени нет.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';

/** Все статусы непустые, чтобы ряд статусов был длинным. */
function games(): G[] {
  const st = ['playing', 'completed', 'backlog', 'dropped', 'paused', 'service', 'none'] as const;
  return [...seed(), ...st.flatMap((s, k) => Array.from({ length: 2 }, (_, i) => ({
    id: 500 + k * 10 + i, title: `Игра ${s} ${i}`, lastPlayedAt: new Date(Date.UTC(2026, 8, 20 - i, 10)).toISOString(), status: s as G['status'],
    completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null,
  })))];
}

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, games());
  await page.goto('/');
}

test('статусы: тень справа, после прокрутки — слева; выбранный чип докручивается в видимую область', async ({ page, context, baseURL, isMobile }) => {
  test.skip(!isMobile, 'на телефоне');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, context, baseURL!);
  const row = page.locator('.ps-tabs.ps-chiprow').first();
  await expect(row.getByRole('button', { name: /^Все/ })).toBeVisible();
  const over = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
  test.skip(!over, 'ряд помещается целиком');
  await expect(row).toHaveAttribute('data-edge-r', '');
  await expect(row).not.toHaveAttribute('data-edge-l', '');
  await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(row).toHaveAttribute('data-edge-l', '');
  await expect(row).not.toHaveAttribute('data-edge-r', '');
  // выбор вне видимой области (как при смене статуса из другого места) → ряд докручивается
  await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await row.evaluate((el) => {
    const first = el.querySelector('button')!;
    el.querySelectorAll('[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    first.setAttribute('aria-pressed', 'true');
  });
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(row).not.toHaveAttribute('data-edge-l', '');
});

test('десктоп: ряд статусов без тени', async ({ page, context, baseURL, isMobile }) => {
  test.skip(!!isMobile, 'десктоп');
  await open(page, context, baseURL!);
  const row = page.locator('.ps-tabs.ps-chiprow').first();
  await expect(row.getByRole('button', { name: /^Все/ })).toBeVisible();
  await expect(row).not.toHaveAttribute('data-edge-r', '');
  await expect(row).not.toHaveAttribute('data-edge-l', '');
});
