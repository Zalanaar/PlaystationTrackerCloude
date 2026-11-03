// Фаза 28: полоса «С прошлого визита» и карточка «Что нового». API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

const FULL = {
  newGames: 3, newGamesWindow: '24h', newUnsorted: 2, trophies: 14, platinums: 1, trophiesWindow: '24h',
  hoursWeek: 12.5, hoursPrevWeek: 9.5, checkCount: 4, forgottenCount: 7, isEmpty: false,
};

type Opts = { inbox?: Record<string, unknown> | null; role?: 'owner' | 'member'; shouldAutoStart?: boolean; seen?: string | null; url?: string; fails?: number; delay?: number };

async function open(page: Page, context: BrowserContext, baseURL: string, o: Opts = {}): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, seed());
  mock.inbox = o.inbox ?? null;
  mock.inboxFails = o.fails ?? 0;
  mock.inboxDelay = o.delay ?? 0;
  mock.hints = [{ gameId: 6, rule: 'started', currentStatus: 'backlog' }];
  await page.route('**/api/auth/me', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: o.role ?? 'owner', amr: 'password' } }),
  }));
  await page.route('**/api/me/tour', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: o.shouldAutoStart ? 0 : 1, shouldAutoStart: o.shouldAutoStart ?? false } }),
  }));
  // по умолчанию «Что нового» уже прочитано, чтобы карточка не мешала проверкам полосы
  const seen = o.seen === undefined ? '12' : o.seen;
  if (seen !== null) await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ['ps-wn-seen:1', seen]);
  await page.goto(o.url ?? '/');
  if (!(o.url ?? '/').startsWith('/triage')) await page.locator('.ps-card').first().waitFor();
  return mock;
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('Полоса «С прошлого визита»', () => {
  test('пустой ответ: полосы нет, скелет ушёл, Коллекция на месте', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(page.getByTestId('inbox-skeleton')).toHaveCount(0);
    await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
    await expect(page.getByTestId('inbox-error')).toHaveCount(0);
    await expect(page.locator('.ps-card').first()).toBeVisible();
  });

  test('скелет, пока ответа нет', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    const mock = await mockApi(page, seed());
    mock.inbox = FULL;
    mock.inboxDelay = 1500;
    await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '12'));
    await page.goto('/');
    const sk = page.getByTestId('inbox-skeleton');
    await expect(sk).toHaveAttribute('aria-busy', 'true');
    await expect(sk).toHaveAttribute('aria-label', 'Загрузка сводки');
    // страница не ждёт полосу: карточки и маркер готовности уже есть
    await expect(page.locator('[data-tour-ready="true"]')).toBeVisible();
    await expect(page.getByTestId('inbox-strip')).toBeVisible();
    await expect(sk).toHaveCount(0);
  });

  test('полная: 5 чипов в порядке, ссылки, тексты; check-chip скрыт', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: FULL });
    const strip = page.getByTestId('inbox-strip');
    await expect(strip).toHaveAttribute('data-count', '5');
    const mobile = isMobile(page);
    const ids = ['inbox-new', 'inbox-trophies', 'inbox-hours', 'inbox-check', 'inbox-forgotten'];
    if (!mobile) {
      for (const id of ids) await expect(strip.getByTestId(id)).toBeVisible();
      await expect(strip.getByTestId('inbox-new')).toContainText('+3 новые игры за 24 ч · Разобрать 2');
      await expect(strip.getByTestId('inbox-trophies')).toContainText('+14 трофеев за 24 ч, платин: 1');
      await expect(strip.getByTestId('inbox-hours')).toContainText('Неделя: 12 ч 30 м, на 3 ч больше прошлой');
      await expect(strip.getByTestId('inbox-hours')).toHaveAttribute('href', '/stats');
    }
    await expect(strip.getByTestId('inbox-new')).toHaveAttribute('href', '/triage');
    await expect(strip.getByTestId('inbox-new')).toHaveAttribute('data-window', 'h24');
    await expect(strip.getByTestId('inbox-trophies')).toHaveAttribute('href', '/stats');
    await expect(strip.getByTestId('inbox-check')).toHaveAttribute('href', '/triage?mode=check');
    await expect(strip.getByTestId('inbox-forgotten')).toHaveAttribute('href', '/triage?forgotten=1');
    // чип в одном ряду: порядок слева направо
    const order = await strip.locator('[data-testid^="inbox-"][href]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(mobile ? ids.filter((i) => i !== 'inbox-hours') : ids);
    await expect(page.getByTestId('check-chip')).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
    // полоса над hero
    const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
    expect(await y('[data-testid="inbox-strip"]')).toBeLessThan(await y('.ps-hero'));
  });

  test('моб.: «Ещё 1» раскрывает часы, чипы по 44', async ({ page, context, baseURL }) => {
    test.skip(!isMobile(page), 'только мобильный');
    await open(page, context, baseURL!, { inbox: FULL });
    const strip = page.getByTestId('inbox-strip');
    await expect(strip.getByTestId('inbox-hours')).toHaveCount(0);
    const more = strip.getByTestId('inbox-more');
    await expect(more).toHaveText('Ещё 1');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const box = await strip.getByTestId('inbox-new').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await more.click();
    await expect(strip.getByTestId('inbox-hours')).toBeVisible();
    await expect(strip.getByTestId('inbox-hours')).toContainText('12 ч 30 м · +3 ч');
    await expect(more).toHaveText('Свернуть');
    await more.click();
    await expect(strip.getByTestId('inbox-hours')).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
  });

  test('один чип; 24 ч пусто, 7 дн. есть', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: { forgottenCount: 5, isEmpty: false } });
    const strip = page.getByTestId('inbox-strip');
    await expect(strip).toHaveAttribute('data-count', '1');
    await expect(strip.getByTestId('inbox-forgotten')).toContainText('Забытые: 5');
    await page.reload();
  });

  test('окно 7 дн.', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: { newGames: 2, newGamesWindow: '7d', newUnsorted: 1, isEmpty: false } });
    const chip = page.getByTestId('inbox-new');
    await expect(chip).toHaveAttribute('data-window', 'd7');
    if (!isMobile(page)) await expect(chip).toContainText('за 7 дн.');
  });

  test('✕ скрывает до завтра, check-chip возвращается, после перезагрузки полосы нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: FULL });
    await expect(page.getByTestId('check-chip')).toHaveCount(0);
    await page.getByTestId('inbox-hide').click();
    await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('ps-inbox-hide:1'));
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId('check-chip')).toBeVisible();
    await page.reload();
    await page.locator('.ps-card').first().waitFor();
    await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
    await expect(page.getByTestId('inbox-skeleton')).toHaveCount(0);
    // вчерашняя дата не скрывает
    await page.evaluate(() => localStorage.setItem('ps-inbox-hide:1', '2020-01-01'));
    await page.reload();
    await expect(page.getByTestId('inbox-strip')).toBeVisible();
  });

  test('ошибка: Коллекция рендерится, «Повторить» возвращает полосу', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: FULL, fails: 1 });
    const err = page.getByTestId('inbox-error');
    await expect(err).toHaveText(/Сводку загрузить не удалось/);
    await expect(err).toHaveAttribute('role', 'status');
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await page.getByTestId('inbox-retry').click();
    await expect(page.getByTestId('inbox-strip')).toBeVisible();
    await expect(err).toHaveCount(0);
  });

  test('второй подряд сбой: строка исчезает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: FULL, fails: 2 });
    await page.getByTestId('inbox-retry').click();
    await expect(page.getByTestId('inbox-error')).toHaveCount(0);
    await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
    await expect(page.locator('.ps-card').first()).toBeVisible();
  });

  test('полосы нет при поиске и фильтре статуса', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { inbox: FULL, url: '/?q=Stray' });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
    await expect(page.getByTestId('inbox-skeleton')).toHaveCount(0);
    await page.goto('/?status=backlog');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
  });
});

test.describe('Что нового', () => {
  const card = (page: Page) => page.getByTestId('whats-new');
  const seenNow = (page: Page) => page.evaluate(() => localStorage.getItem('ps-wn-seen:1'));

  test('первый запуск: 3 записи с highlight, «Понятно» отмечает, после перезагрузки нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { seen: null });
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute('role', 'region');
    await expect(page.getByTestId('whats-new-count')).toHaveText('1 из 3');
    await expect(page.getByTestId('whats-new-title')).toHaveText('С прошлого визита');
    await page.getByTestId('whats-new-next').click();
    await expect(page.getByTestId('whats-new-title')).toHaveText('История игры');
    await page.getByTestId('whats-new-next').click();
    await expect(page.getByTestId('whats-new-count')).toHaveText('3 из 3');
    await expect(page.getByTestId('whats-new-title')).toHaveText('«У тебя нет»');
    await expect(page.getByTestId('whats-new-go')).toHaveAttribute('href', '/recommend?tab=discover');
    await expect(page.getByTestId('whats-new-next')).toHaveText('Понятно');
    await page.getByTestId('whats-new-next').click();
    await expect(card(page)).toHaveCount(0);
    expect(await seenNow(page)).toBe('12');
    await page.reload();
    await page.locator('.ps-card').first().waitFor();
    await page.waitForTimeout(2500);
    await expect(card(page)).toHaveCount(0);
  });

  test('✕ и Esc закрывают и отмечают; позиция над tab bar на мобильном', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { seen: null });
    await expect(card(page)).toBeVisible();
    if (isMobile(page)) {
      const c = (await card(page).boundingBox())!;
      const t = (await page.locator('nav.ps-tabbar').boundingBox())!;
      expect(c.y + c.height).toBeLessThanOrEqual(t.y);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.getByTestId('whats-new-next').focus();
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    expect(await seenNow(page)).toBe('12');
  });

  test('новая запись по ключу: старые прочитаны, показываются только новые', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { seen: '10' });
    await expect(page.getByTestId('whats-new-count')).toHaveText('1 из 2');
    await expect(page.getByTestId('whats-new-title')).toHaveText('С прошлого визита');
  });

  test('меню открывает последние 6 и не меняет отметку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(card(page)).toHaveCount(0);
    if (isMobile(page)) await page.getByRole('button', { name: 'Меню', exact: true }).click();
    else await page.locator('.ps-avatar').click();
    await page.getByTestId('menu-whats-new').click();
    await expect(page.getByTestId('whats-new-count')).toHaveText('1 из 6');
    await page.getByTestId('whats-new-close').click();
    await expect(card(page)).toHaveCount(0);
    expect(await seenNow(page)).toBe('12');
  });

  test('member не видит запись owner в первом запуске/меню', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { role: 'member', seen: '3' });
    await expect(page.getByTestId('whats-new-count')).toHaveText('1 из 3');
    await page.getByTestId('whats-new-close').click();
    if (isMobile(page)) await page.getByRole('button', { name: 'Меню', exact: true }).click();
    else await page.locator('.ps-avatar').click();
    await page.getByTestId('menu-whats-new').click();
    await expect(page.getByTestId('whats-new-count')).toHaveText('1 из 6');
  });

  test('автозапуск тура: карточки нет, после «Пропустить» записи прочитаны', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { seen: null, shouldAutoStart: true });
    await expect(page.getByTestId('tour-count')).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(card(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Пропустить тур' }).click();
    await expect(page.getByTestId('tour-count')).toHaveCount(0);
    await page.waitForTimeout(2200);
    await expect(card(page)).toHaveCount(0);
    expect(await seenNow(page)).toBe('12');
  });

  test('тур стартует при видимой карточке: скрыта без отметки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { seen: null });
    await expect(card(page)).toBeVisible();
    // «Как пользоваться» через меню недоступно под карточкой на мобильном: запускаем через меню, как пользователь
    if (isMobile(page)) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); await page.getByRole('button', { name: 'Как пользоваться' }).click(); }
    else { await page.locator('.ps-avatar').click(); await page.getByRole('menuitem', { name: 'Как пользоваться' }).click(); }
    await expect(page.getByTestId('tour-count')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(await seenNow(page)).toBeNull();
  });

  test('на Разборе и с ?game= карточки нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { seen: null, url: '/triage' });
    await page.waitForTimeout(3500);
    await expect(card(page)).toHaveCount(0);
    await page.goto('/?game=1');
    await page.waitForTimeout(3500);
    await expect(card(page)).toHaveCount(0);
    expect(await seenNow(page)).toBeNull();
  });
});
