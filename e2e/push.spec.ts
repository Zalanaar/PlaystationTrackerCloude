// П14.2: «Уведомления на этом устройстве» в «Настройках». API и Push API браузера эмулируются: включение (разрешение → подписка → POST),
// проверка, выключение, «не настроено», iPhone вне PWA, запрет; 360/390 px без скролла, кнопки 44, axe во всех темах.
import { createRequire } from 'node:module';
import { settle } from './settle';
import { test, expect, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';
import { emptyGamesBody } from './collection-mock';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

type Cfg = { configured?: boolean; permission?: 'default' | 'granted' | 'denied'; grant?: 'granted' | 'denied'; ios?: boolean; subscribed?: boolean };

async function open(page: Page, baseURL: string, cfg: Cfg = {}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: { totals: null, running: false, lastSuccessAt: null, psnAuthExpiresAt: null, psnAuth: 'ok', run: null, psnToken: null } }));
  await page.route('**/api/games**', (r) => json(r, emptyGamesBody(r.request().url())));
  let tests = 0;
  await page.route('**/api/me/push/test', (r) => { calls.push('test'); tests++; return tests > 1 ? json(r, { ok: false, error: { code: 'rate_limited', message: 'x' } }, 429) : json(r, { ok: true, data: { sent: 1, removed: 0 } }); });
  await page.route('**/api/me/push', (r) => {
    const m = r.request().method();
    calls.push(m);
    if (m !== 'GET') bodies.push(r.request().postDataJSON());
    if (m === 'GET') return json(r, { ok: true, data: { configured: cfg.configured ?? true, publicKey: cfg.configured === false ? null : KEY, devices: cfg.subscribed ? 1 : 0, shelvedReminder: true } });
    if (m === 'PATCH') return json(r, { ok: true, data: r.request().postDataJSON() });
    return json(r, { ok: true, data: { subscribed: m === 'POST', devices: m === 'POST' ? 1 : 0 } });
  });
  // эмуляция Push API: регистрация SW с pushManager, Notification.permission / requestPermission, iPhone вне PWA
  await page.addInitScript((c) => {
    let perm = c.permission ?? 'default';
    let sub: unknown = c.subscribed ? mk() : null;
    function mk() {
      return { endpoint: 'https://web.push.apple.com/fake', unsubscribe: async () => { sub = null; return true; }, toJSON: () => ({ endpoint: 'https://web.push.apple.com/fake', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }) };
    }
    const pushManager = { getSubscription: async () => sub, subscribe: async (o: { applicationServerKey: Uint8Array }) => { (window as unknown as { __askey: number }).__askey = o.applicationServerKey.length; sub = mk(); return sub; } };
    const reg = { pushManager };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => reg, register: async () => reg, addEventListener() {}, removeEventListener() {}, controller: null } });
    (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
    (window as unknown as { Notification: unknown }).Notification = Object.assign(function Notification() {}, {
      get permission() { return perm; },
      requestPermission: async () => { perm = c.grant ?? 'granted'; return perm; },
    });
    // приложение с экрана «Домой» (navigator.standalone), кроме сценария «iPhone в Safari»: в проекте webkit-iphone UA уже iPhone
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => !c.ios });
    if (c.ios) {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    }
  }, cfg);
  await page.goto('/settings');
  const panel = page.getByTestId('push-panel');
  await panel.waitFor();
  return { panel, calls, bodies };
}

test('включение: разрешение → подписка → сервер; проверка (раз в минуту); выключение', async ({ page, baseURL }) => {
  const { panel, calls, bodies } = await open(page, baseURL!);
  await panel.getByTestId('push-enable').click();
  await expect(panel.getByTestId('push-status')).toHaveText('Включены');
  await expect(panel.getByTestId('push-msg')).toHaveText('Уведомления включены на этом устройстве.');
  expect(await page.evaluate(() => (window as unknown as { __askey: number }).__askey)).toBe(65); // ключ VAPID — 65 байт
  expect(bodies[0]).toEqual({ endpoint: 'https://web.push.apple.com/fake', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });
  await panel.getByTestId('push-test').click();
  await expect(panel.getByTestId('push-msg')).toContainText('Отправлено');
  await panel.getByTestId('push-test').click();
  await expect(panel.getByTestId('push-msg')).toHaveText('Проверять можно не чаще раза в минуту.');
  await panel.getByTestId('push-disable').click();
  await expect(panel.getByTestId('push-enable')).toBeVisible();
  expect(bodies.at(-1)).toEqual({ endpoint: 'https://web.push.apple.com/fake' });
  expect(calls.filter((c) => c !== 'GET')).toEqual(['POST', 'test', 'test', 'DELETE']);
});

test('уже включено: «Включены», подписка тихо сверяется с сервером', async ({ page, baseURL }) => {
  const { panel, calls } = await open(page, baseURL!, { subscribed: true, permission: 'granted' });
  await expect(panel.getByTestId('push-status')).toHaveText('Включены');
  await expect.poll(() => calls.includes('POST')).toBe(true);
});

test('отказ в разрешении: подсказка про настройки', async ({ page, baseURL }) => {
  const { panel, calls } = await open(page, baseURL!, { grant: 'denied' });
  await panel.getByTestId('push-enable').click();
  await expect(panel.getByTestId('push-note')).toContainText('Настройки → Уведомления → PS Tracker');
  expect(calls).not.toContain('POST');
});

test('сервер без ключей: «пока не включены», кнопки нет', async ({ page, baseURL }) => {
  const { panel } = await open(page, baseURL!, { configured: false });
  await expect(panel.getByTestId('push-note')).toHaveText('Уведомления пока не включены на сервере.');
  await expect(panel.getByTestId('push-enable')).toHaveCount(0);
});

test('переключатель напоминания об «Отложено»: по умолчанию включён, выключается PATCH', async ({ page, baseURL }) => {
  const { panel, calls, bodies } = await open(page, baseURL!);
  const box = panel.getByTestId('push-shelved');
  await expect(box).toContainText('Отложено');
  await expect(box.locator('input')).toBeChecked();
  await box.click();
  await expect(box.locator('input')).not.toBeChecked();
  expect(calls).toContain('PATCH');
  expect(bodies.some((b) => (b as { shelvedReminder?: boolean }).shelvedReminder === false)).toBe(true);
});

test('iPhone в Safari (не с экрана «Домой»): как установить', async ({ page, baseURL }) => {
  const { panel } = await open(page, baseURL!, { ios: true });
  await expect(panel.getByTestId('push-note')).toContainText('«На экран «Домой»»');
  await expect(panel.getByTestId('push-enable')).toHaveCount(0);
});

for (const w of [360, 390]) {
  test(`${w} px: без скролла, кнопки 44, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    const { panel } = await open(page, baseURL!, { subscribed: true, permission: 'granted' });
    await expect(panel.getByTestId('push-status')).toBeVisible();
    for (const id of ['push-test', 'push-disable']) expect((await panel.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await settle(page);
      const run = () => page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['[data-testid="push-panel"]']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      let v = await run();
      if (v.length) { await page.waitForTimeout(1000); v = await run(); } // WebKit: контраст посреди перехода
      expect(v, t).toEqual([]);
    }
  });
}
