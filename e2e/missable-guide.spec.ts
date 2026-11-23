// Когда игра переходит в «Играю» — лист «Не пропусти» со ссылками на сопоставленный гайд (без текста гайда).
import { createRequire } from 'node:module';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const GUIDE = {
  match: { title: 'Hades', url: 'https://www.powerpyx.com/hades-trophy-guide-roadmap/', wikiUrl: 'https://www.powerpyx.com/hades-wiki-strategy-guide/' },
  override: null,
  dismissed: false,
};

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  return m;
}

async function mockGuide(page: Page, gameId: number, body: unknown | 'fail') {
  await page.route(new RegExp(`/api/games/${gameId}/guide$`), (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (body === 'fail') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { guide: body } }) });
  });
}

const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');

async function startPlaying(page: Page, title: string) {
  await coll(page).getByRole('button', { name: `Статус: ${title}` }).first().click();
  await page.getByRole('menuitemradio', { name: 'Играю' }).click();
}

test('«Играю» → «Не пропусти» со ссылками на гайд и вики; «Позже» закрывает', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string);
  m.guides[5] = GUIDE;
  await startPlaying(page, 'Hades');
  const sheet = page.getByRole('dialog', { name: 'Не пропусти' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('missable-guide')).toContainText('Hades');
  const guide = sheet.getByTestId('missable-link-guide');
  const wiki = sheet.getByTestId('missable-link-wiki');
  await expect(guide).toHaveAttribute('href', GUIDE.match.url);
  await expect(wiki).toHaveAttribute('href', GUIDE.match.wikiUrl);
  await expect(guide).toHaveAttribute('target', '_blank');
  await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');

  await page.evaluate(createRequire(import.meta.url)('axe-core').source as string);
  const v = await page.evaluate(async () => {
    const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await ax.run('[data-testid="missable-guide"]', { resultTypes: ['violations'] });
    return r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')}`));
  });
  expect(v).toEqual([]);

  await sheet.getByTestId('missable-later').click();
  await expect(sheet).toHaveCount(0);
});

test('своя ссылка важнее совпадения', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string);
  m.guides[6] = { match: GUIDE.match, override: 'https://example.com/my-guide', dismissed: false };
  await page.goto('/?status=backlog');
  await startPlaying(page, 'Stray');
  const sheet = page.getByRole('dialog', { name: 'Не пропусти' });
  await expect(sheet.getByTestId('missable-link-own')).toHaveAttribute('href', 'https://example.com/my-guide');
  await expect(sheet.getByTestId('missable-link-guide')).toHaveCount(0);
  await sheet.getByTestId('missable-later').click();
  await expect(sheet).toHaveCount(0);
});

test('без гайда лист не показывается', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string);
  m.guides[8] = { match: null, override: null, dismissed: false };
  const empty = page.waitForResponse((r) => /\/api\/games\/8\/guide$/.test(r.url()) && r.request().method() === 'GET');
  await startPlaying(page, 'Tetris Effect');
  expect((await empty).ok()).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Не пропусти' })).toHaveCount(0);
});

test('ошибка загрузки гайда — лист не показывается', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string);
  await mockGuide(page, 5, 'fail');
  const failed = page.waitForResponse((r) => /\/api\/games\/5\/guide$/.test(r.url()) && r.request().method() === 'GET');
  await startPlaying(page, 'Hades');
  expect((await failed).status()).toBe(503);
  await expect(page.getByRole('dialog', { name: 'Не пропусти' })).toHaveCount(0);
});
