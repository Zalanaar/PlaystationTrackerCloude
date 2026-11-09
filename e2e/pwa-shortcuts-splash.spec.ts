// Пакет 6, п. 8: ярлыки PWA в манифесте («Бэклог», «Статистика», «Добавить игру») и заставки запуска iOS (apple-touch-startup-image).
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

test('манифест: три ярлыка с иконками, адреса внутри scope', async ({ request, baseURL }) => {
  const m = await (await request.get(`${baseURL}/manifest.webmanifest`)).json();
  expect(m.shortcuts.map((s: { name: string; url: string }) => [s.name, s.url])).toEqual([['Бэклог', '/backlog'], ['Статистика', '/stats'], ['Добавить игру', '/?add=other']]);
  for (const s of m.shortcuts) {
    expect(s.icons[0].src).toBe('/icons/icon-192.png');
  }
});

test('заставки iOS: ссылки по экранам iPhone в портрете, картинки открыты без сессии и нужного размера', async ({ page, request, baseURL }) => {
  await page.goto('/login');
  const links = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href')!, media: e.getAttribute('media') ?? '' })));
  expect(links.length).toBe(12);
  const iphone13 = links.find((l) => l.media.includes('device-width: 390px') && l.media.includes('device-height: 844px'));
  expect(iphone13?.href).toBe('/splash/iphone-1170x2532.png');
  for (const l of links) {
    expect(l.media).toContain('orientation: portrait');
    const r = await request.get(`${baseURL}${l.href}`, { maxRedirects: 0 });
    expect(r.status(), l.href).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
    // PNG: ширина и высота в заголовке IHDR совпадают с именем файла
    const b = await r.body();
    const [w, h] = /(\d+)x(\d+)\.png$/.exec(l.href)!.slice(1).map(Number);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)], l.href).toEqual([w, h]);
  }
});

test('ярлык «Добавить игру»: /?add=other открывает панель добавления и убирает параметр из адреса', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto('/?add=other');
  await expect(page.getByRole('dialog', { name: 'Играл на другой платформе' })).toBeVisible();
  await expect(page).not.toHaveURL(/add=/);
});
