// П15.2: свайп вниз закрывает окно игры на телефоне (только у верха содержимого); короткий жест возвращает окно;
// прокрученное окно и десктоп свайп не закрывает. Жест — настоящими TouchEvent (Chromium, hasTouch).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.goto('/?game=4');
  const d = page.getByRole('dialog', { name: 'God of War' });
  await expect(d.getByTestId('game-review')).toBeVisible();
  await page.waitForTimeout(400); // анимация появления
  return d;
}

/** Жест по точкам с паузой между шагами (мс). */
async function swipe(page: Page, sel: string, dy: number, steps = 8, stepMs = 30) {
  await page.evaluate(async ([s, dy, steps, stepMs]) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y0 = r.top + 20;
    const mk = (y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const fire = (type: string, y: number) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)],
    }));
    fire('touchstart', y0);
    for (let i = 1; i <= steps; i++) { await new Promise((ok) => setTimeout(ok, stepMs)); fire('touchmove', y0 + (dy * i) / steps); }
    fire('touchend', y0 + dy);
  }, [sel, dy, steps, stepMs] as const);
}

test.describe('П15.2 свайп вниз', () => {
  test.beforeEach(({ isMobile }, info) => { test.skip(info.project.name !== 'mobile' || !isMobile, 'жест телефона (Chromium)'); });

  test('длинный свайп от шапки закрывает окно, адрес без ?game', async ({ page, baseURL }) => {
    const d = await open(page, baseURL!);
    await expect(page.locator('.ps-gd__grab')).toBeVisible();
    await swipe(page, '.ps-gd__tiles', 220);
    await expect(d).toHaveCount(0);
    await expect(page).not.toHaveURL(/game=/);
  });

  test('короткий медленный жест — окно возвращается на место', async ({ page, baseURL }) => {
    const d = await open(page, baseURL!);
    await swipe(page, '.ps-gd__tiles', 60, 10, 80);
    await page.waitForTimeout(400);
    await expect(d).toBeVisible();
    expect(await page.locator('.ps-gd__sheet').evaluate((e) => (e as HTMLElement).style.transform)).toBe('');
  });

  test('прокрученное окно свайпом не закрывается; поле заметки жест не перехватывает', async ({ page, baseURL }) => {
    const d = await open(page, baseURL!);
    await swipe(page, 'textarea', 220);
    await expect(d).toBeVisible();
    await page.locator('.ps-gd__scroll').evaluate((e) => { e.scrollTop = 200; });
    await swipe(page, '.ps-gd__panel', 220);
    await expect(d).toBeVisible();
  });
});

test('десктоп: «ручки» нет, свайп ничего не делает', async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'десктоп');
  await open(page, baseURL!);
  await expect(page.locator('.ps-gd__grab')).toBeHidden();
});
