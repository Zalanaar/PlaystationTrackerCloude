// П12.5: «У меня 2 часа» — пункт меню страницы «Бэклог» открывает окно: выбор времени (запрос с minutes), «Успеешь пройти»
// и «Продолжить», строка открывает окно игры; пусто/сбой; 360 px без скролла, кнопки 44, axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

const bl = (id: number, title: string, status: G['status'] = 'backlog'): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status, completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, genres: ['ACTION'],
});
const item = (id: number, title: string, status: 'playing' | 'backlog', remainingMinutes: number | null) => ({ id, title, coverUrl: null, status, remainingMinutes, lastPlayedAt: null });

async function open(page: Page, baseURL: string, respond: (minutes: number) => { status?: number; body: unknown }) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await mockApi(page, [bl(1, 'Альфа Короткая'), bl(2, 'Браво Длинная', 'playing'), bl(3, 'Чарли')]);
  const calls: number[] = [];
  await page.route(/\/api\/collection\/time-fit(\?|$)/, (r) => {
    const m = Number(new URL(r.request().url()).searchParams.get('minutes'));
    calls.push(m);
    const x = respond(m);
    return r.fulfill({ status: x.status ?? 200, contentType: 'application/json', body: JSON.stringify(x.status ? x.body : { ok: true, data: x.body }) });
  });
  await page.goto('/backlog');
  await page.locator('.ps-blrow, .ps-card:not(.ps-card--sk)').first().waitFor();
  await page.getByTestId('bl-menu').click();
  await page.getByTestId('bl-menu-time').click();
  const dlg = page.getByRole('dialog', { name: 'Сколько есть времени?' });
  await expect(dlg).toBeVisible();
  return { dlg, calls };
}

const data = (minutes: number) => ({
  minutes,
  finish: minutes >= 120 ? [item(2, 'Браво Длинная', 'playing', 60), item(1, 'Альфа Короткая', 'backlog', 130)] : [],
  resume: minutes >= 120 ? [] : [item(2, 'Браво Длинная', 'playing', 60)],
});

test('по умолчанию 2 ч, переключение времени, строка открывает окно игры', async ({ page, baseURL }) => {
  const { dlg, calls } = await open(page, baseURL!, (m) => ({ body: data(m) }));
  await expect(dlg.getByRole('button', { name: '2 ч', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const finish = dlg.getByTestId('tfit-finish').getByTestId('tfit-row');
  await expect(finish).toHaveCount(2);
  await expect(finish.first()).toContainText('Браво Длинная');
  await expect(finish.first()).toContainText('Играю · осталось ≈ 1 ч');
  await expect(finish.nth(1)).toContainText('Бэклог · осталось ≈ 2 ч 10 мин, впритык');
  expect([...new Set(calls)]).toEqual([120]); // dev StrictMode может повторить эффект

  await dlg.getByRole('button', { name: '1 ч', exact: true }).click();
  await expect(dlg.getByTestId('tfit-empty')).toHaveText(/пройти ничего не выйдет/);
  await expect(dlg.getByTestId('tfit-resume').getByTestId('tfit-row')).toHaveCount(1);
  expect([...new Set(calls)]).toEqual([120, 60]);

  await dlg.getByTestId('tfit-resume').getByTestId('tfit-row').click();
  await expect(dlg).toBeHidden();
  await expect(page).toHaveURL(/[?&]game=2\b/);
});

test('совсем пусто и сбой', async ({ page, baseURL }) => {
  let fail = false;
  const { dlg } = await open(page, baseURL!, (m) => (fail ? { status: 503, body: { ok: false, error: { code: 'db_unavailable', message: 'x' } } } : { body: { minutes: m, finish: [], resume: [] } }));
  await expect(dlg.getByTestId('tfit-empty')).toHaveText(/Ничего не помещается/);
  fail = true;
  await dlg.getByRole('button', { name: '3 ч', exact: true }).click();
  await expect(dlg.getByRole('alert')).toContainText('Не удалось подобрать игры');
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, кнопки 44, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    const { dlg } = await open(page, baseURL!, (m) => ({ body: { ...data(m), resume: [item(3, 'Чарли с очень длинным названием игры для проверки обрезки строки', 'playing', null)] } }));
    await expect(dlg.getByTestId('tfit-row')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const b of await dlg.locator('.ps-tfit__seg button, .ps-tfit__row').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['.ps-tfit']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}
