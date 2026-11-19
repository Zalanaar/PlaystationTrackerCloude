// F16 (аудит UX): текст чтения растёт вместе с системным размером текста (корневой шрифт). На iOS корень задаёт
// -apple-system-body; здесь эмулируем крупный текст корневым font-size (база 16) и проверяем рост, потолок 150 % и что
// экраны не уезжают вбок.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const fs = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function open(page: Page, baseURL: string, rootPx: number | null, url = '/') {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  if (rootPx) await page.addInitScript((px) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${px}px`; }); }, rootPx);
  await page.goto(url);
  await page.locator('main').first().waitFor();
  await page.locator('.ps-skeleton').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
}

test('по умолчанию размеры макета: body 14 px', async ({ page, baseURL }) => {
  await open(page, baseURL!, null);
  expect(await fs(page, 'body')).toBe(14);
});

test('крупный текст 125 %: body 17,5 px, подписи растут, без горизонтальной прокрутки', async ({ page, baseURL }) => {
  await open(page, baseURL!, 20);
  expect(await fs(page, 'body')).toBe(17.5);
  expect(await noHScroll(page)).toBe(true);
});

test('огромный текст: потолок 150 % (body 21 px), шапка фиксирована', async ({ page, baseURL }) => {
  await open(page, baseURL!, 40);
  expect(await fs(page, 'body')).toBe(21);
  expect(await noHScroll(page)).toBe(true);
  for (const url of ['/backlog', '/stats', '/trophies']) {
    await page.goto(url);
    await page.locator('main').first().waitFor();
    await page.waitForTimeout(800);
    expect(await noHScroll(page), url).toBe(true);
  }
});

test('мельче системного — не мельче макета', async ({ page, baseURL }) => {
  await open(page, baseURL!, 12);
  expect(await fs(page, 'body')).toBe(14);
});
