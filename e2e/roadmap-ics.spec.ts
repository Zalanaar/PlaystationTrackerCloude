// П12.6 + живая подписка: под блоком «Релизы» — «Подписка на календарь» (webcal-ссылка с ключом один раз, копирование,
// новая ссылка, отключение) и разовый файл .ics (только при будущих релизах). 360/390 px без скролла, высота 44, axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, type RmPlanned } from './roadmap-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const day = (d: number) => new Date(Date.now() + 3 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10);
const rel = (id: number, title: string, date: string | null, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: date, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, status: 'planned', ...o,
});

type Feed = { active: boolean; createdAt: string | null; issued: number; revoked: number };

async function open(page: Page, baseURL: string, planned: RmPlanned[], feed: Feed = { active: false, createdAt: null, issued: 0, revoked: 0 }) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState({ planned, today: day(0) })); // «сегодня» настоящее: иначе фиксированная дата мока делает «вышедшую» игру будущей
  await page.route('**/api/roadmap/releases.ics', (r) => r.fulfill({
    status: 200, body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="releases.ics"' },
  }));
  await page.route(/\/api\/roadmap\/calendar$/, async (r) => {
    const m = r.request().method();
    if (m === 'POST') {
      feed.issued += 1; feed.active = true; feed.createdAt = '2026-11-18T22:00:00.000Z';
      const token = String(feed.issued).repeat(43).slice(0, 43);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { active: true, createdAt: feed.createdAt, path: `/api/cal/${token}.ics` } }) });
    }
    if (m === 'DELETE') { feed.revoked += 1; feed.active = false; feed.createdAt = null; }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { active: feed.active, createdAt: feed.createdAt } }) });
  });
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  await page.getByRole('heading', { name: /^Релизы/, level: 2 }).waitFor();
}

test('есть будущий релиз: ссылка на .ics; десктоп скачивает файл', async ({ page, baseURL, isMobile, browserName }) => {
  await open(page, baseURL!, [rel(1, 'Будущая игра', day(30), { wantAtRelease: true }), rel(2, 'Без даты', null)]);
  const a = page.getByTestId('rm-ics');
  await expect(a).toBeVisible();
  await expect(a).toHaveAttribute('href', '/api/roadmap/releases.ics');
  await expect(a).toHaveText('Скачать файл .ics');
  test.skip(isMobile || browserName !== 'chromium', 'скачивание проверяем на десктопе');
  const [dl] = await Promise.all([page.waitForEvent('download'), a.click()]);
  expect(dl.suggestedFilename()).toBe('releases.ics');
});

test('подписка: ссылка один раз, webcal, копирование, новая ссылка, отключение', async ({ page, baseURL, browserName }) => {
  const feed: Feed = { active: false, createdAt: null, issued: 0, revoked: 0 };
  await open(page, baseURL!, [rel(1, 'Будущая игра', day(30))], feed);
  const box = page.getByTestId('rm-cal');
  await expect(box).toContainText('без заметок и цен');
  await page.getByTestId('rm-cal-issue').click();
  const url = page.getByTestId('rm-cal-url');
  await expect(url).toHaveValue(new RegExp(`^https?://[^/]+/api/cal/1{43}\\.ics$`));
  await expect(page.getByTestId('rm-cal-webcal')).toHaveAttribute('href', /^webcal:\/\/[^/]+\/api\/cal\/1{43}\.ics$/);
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('rm-cal-copy').click();
    await expect(page.getByTestId('rm-cal-msg')).toHaveText('Ссылка скопирована.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await url.inputValue());
  }
  await page.getByTestId('rm-cal-regen').click();
  await expect(box).toContainText('Старая ссылка перестанет работать.');
  await page.getByTestId('rm-cal-confirm').click();
  await expect(url).toHaveValue(/\/api\/cal\/2{43}\.ics$/);
  await page.getByTestId('rm-cal-off').click();
  await page.getByTestId('rm-cal-confirm').click();
  await expect(page.getByTestId('rm-cal-msg')).toContainText('Подписка отключена');
  await expect(url).toHaveCount(0);
  await expect(page.getByTestId('rm-cal-issue')).toBeEnabled();
  expect(feed).toMatchObject({ issued: 2, revoked: 1, active: false });
});

test('подписка уже включена: ссылку не показываем повторно (в базе только хэш)', async ({ page, baseURL }) => {
  await open(page, baseURL!, [rel(1, 'Будущая игра', day(30))], { active: true, createdAt: '2026-11-10T09:00:00.000Z', issued: 0, revoked: 0 });
  await expect(page.getByTestId('rm-cal-on')).toHaveText('Подписка включена с 10.11.2026.');
  await expect(page.getByTestId('rm-cal-url')).toHaveCount(0);
  await expect(page.getByTestId('rm-cal-regen')).toBeVisible();
});

test('только вышедшие и без даты — ссылки нет', async ({ page, baseURL }) => {
  await open(page, baseURL!, [rel(1, 'Вышла', day(-3)), rel(2, 'Без даты', null)]);
  await expect(page.getByRole('heading', { name: /^Релизы/, level: 2 })).toBeVisible();
  await expect(page.getByTestId('rm-ics')).toHaveCount(0);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, высота 44, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, baseURL!, [rel(1, 'Будущая игра с длинным названием для проверки строки', day(10))]);
    await page.getByTestId('rm-cal-issue').click();
    await page.getByTestId('rm-cal-url').waitFor();
    for (const id of ['rm-ics', 'rm-cal-webcal', 'rm-cal-url', 'rm-cal-copy', 'rm-cal-regen', 'rm-cal-off']) {
      const a = page.getByTestId(id);
      await a.scrollIntoViewIfNeeded();
      expect((await a.boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(500);
      const run = () => page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['.ps-rm-ics'], ['.ps-rm-cal']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      // WebKit: переход цвета кнопки после смены темы бывает дольше 500 мс — один повтор, как в tags.spec
      let v = await run();
      if (v.length) { await page.waitForTimeout(1000); v = await run(); }
      expect(v, t).toEqual([]);
    }
  });
}
