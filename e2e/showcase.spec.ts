// П14.3 «Публичная витрина»: на /profiles закрыта по умолчанию, открытие (ссылка один раз, копирование), новая ссылка, закрытие;
// публичная страница /s/<ключ> без входа: цифры, топ, пройденные; закрытая — «Витрина закрыта»; noindex; 360/390 px, axe во всех темах.
import { createRequire } from 'node:module';
import { settle } from './settle';
import { test, expect, type Page } from '@playwright/test';
import { setup, TWO } from './profiles-mock';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const TOKEN = 'A'.repeat(43);
const DATA = {
  onlineId: 'Artem_PS', avatarUrl: null, trophyLevel: 412,
  values: { games: 214, completed: 53, hours: 1642, trophies: 5120, platinum: 7, achievements: 9 },
  top: [{ name: 'Elden Ring — очень длинное название для проверки обрезки строки', imageUrl: null, hours: 120.5 }, { name: 'Astro Bot', imageUrl: null, hours: 14 }],
  done: [{ name: 'Astro Bot', imageUrl: null, month: '2026-10' }],
};

async function axe(page: Page, sel: string) {
  await page.evaluate(axeSource);
  for (const t of THEMES) {
    await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
    await settle(page);
    const run = () => page.evaluate(async (s) => {
      const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const r = await ax.run({ include: [[s]] }, { resultTypes: ['violations'] });
      return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    }, sel);
    let v = await run();
    if (v.length) { await page.waitForTimeout(1000); v = await run(); } // WebKit: контраст посреди перехода
    expect(v, t).toEqual([]);
  }
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function owner(page: Page, baseURL: string) {
  const st = { open: false, createdAt: null as string | null, n: 0, calls: [] as string[] };
  await setup(page, baseURL, TWO());
  await page.route(/\/api\/me\/showcase$/, (r) => {
    const m = r.request().method();
    st.calls.push(m);
    if (m === 'POST') { st.n++; st.open = true; st.createdAt = '2026-11-18T22:00:00.000Z'; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { open: true, createdAt: st.createdAt, path: `/s/${String(st.n).repeat(43)}` } }) }); }
    if (m === 'DELETE') { st.open = false; st.createdAt = null; }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { open: st.open, createdAt: st.createdAt } }) });
  });
  await page.goto('/profiles');
  await page.getByRole('heading', { level: 1, name: 'Профили PSN' }).waitFor();
  return st;
}

test('владелец: закрыта по умолчанию → открыть → новая ссылка → закрыть', async ({ page, baseURL }) => {
  const st = await owner(page, baseURL!);
  const box = page.getByTestId('psc');
  await expect(box.getByTestId('psc-off')).toHaveText('Сейчас закрыта: её никто не видит.');
  await expect(box).toContainText('Artem_PS');
  await box.getByTestId('psc-open').click();
  await expect(box.getByTestId('psc-url')).toHaveValue(/\/s\/1{43}$/);
  await expect(box.getByTestId('psc-view')).toHaveAttribute('rel', 'noopener noreferrer');
  await box.getByTestId('psc-regen').click();
  await box.getByTestId('psc-confirm').click();
  await expect(box.getByTestId('psc-url')).toHaveValue(/\/s\/2{43}$/);
  await box.getByTestId('psc-close').click();
  await box.getByTestId('psc-confirm').click();
  await expect(box.getByTestId('psc-msg')).toHaveText('Витрина закрыта: ссылка больше не работает.');
  await expect(box.getByTestId('psc-off')).toBeVisible();
  expect(st.calls.filter((c) => c !== 'GET')).toEqual(['POST', 'POST', 'DELETE']);
});

test('публичная страница без входа: цифры, топ, пройденные; noindex', async ({ page }) => {
  await page.route(`**/api/showcase/${TOKEN}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: DATA }) }));
  const res = await page.goto(`/s/${TOKEN}`);
  expect(res!.headers()['x-robots-tag']).toContain('noindex');
  expect(res!.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('heading', { level: 1, name: 'Artem_PS' })).toBeVisible();
  await expect(page).toHaveTitle('Витрина Artem_PS · PS Tracker');
  await expect(page.getByTestId('showcase')).toContainText('Уровень трофеев 412');
  await expect(page.locator('.ps-sc__stat').nth(2)).toContainText('1 642');
  await expect(page.getByTestId('sc-top')).toHaveCount(2);
  await expect(page.getByTestId('sc-top').first()).toContainText('120 ч');
  await expect(page.getByTestId('sc-done').first()).toContainText('октябрь 2026');
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
});

test('закрытая или неверная ссылка — «Витрина закрыта»', async ({ page }) => {
  await page.route('**/api/showcase/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'not_found', message: 'x' } }) }));
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByTestId('showcase-off')).toContainText('Витрина закрыта');
});

for (const w of [360, 390]) {
  test(`${w} px: витрина и блок на /profiles без скролла, кнопки 44, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await page.route(`**/api/showcase/${TOKEN}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: DATA }) }));
    await page.goto(`/s/${TOKEN}`);
    await expect(page.getByTestId('sc-done')).toHaveCount(1);
    await noOverflow(page);
    await axe(page, '.ps-sc');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await owner(page, baseURL!);
    await page.getByTestId('psc-open').click();
    await page.getByTestId('psc-url').waitFor();
    for (const id of ['psc-url', 'psc-copy', 'psc-view', 'psc-regen', 'psc-close']) {
      const el = page.getByTestId(id);
      await el.scrollIntoViewIfNeeded();
      expect((await el.boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    }
    await noOverflow(page);
    await axe(page, '.ps-psc');
  });
}
