// Ревизия 23.11: «У меня 2 часа» в меню Бэклога открывает «Подскажи» с фильтром «Короткая» (?time=short).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const bl = (id: number, title: string, status: G['status'] = 'backlog'): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status, completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, genres: ['ACTION'],
});

async function openBacklog(page: Page, baseURL: string) {
  const calls: string[] = [];
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, [bl(1, 'Альфа Короткая'), bl(2, 'Браво Длинная', 'playing'), bl(3, 'Чарли')]);
  await page.route(/\/api\/recommend(\?.*)?$/, (r) => {
    const q = new URL(r.request().url()).searchParams.get('time') ?? 'any';
    calls.push(q);
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          items: [{
            game: { id: 1, name: 'Альфа Короткая', imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 6, hoursSource: 'hltb' },
            score: 4,
            signals: [],
            reason: { text: 'Короткая игра из бэклога.', source: 'template' },
          }],
          meta: { llm: 'disabled', candidates: 1, backlog: 2, time: q },
        },
      }),
    });
  });
  await page.goto('/backlog');
  await page.locator('.ps-blrow, .ps-card:not(.ps-card--sk), [data-testid="home-backlog-row"]').first().waitFor();
  return { calls };
}

test('пункт меню ведёт в «Подскажи» с фильтром «Короткая»', async ({ page, baseURL }) => {
  const { calls } = await openBacklog(page, baseURL!);
  await page.getByTestId('bl-menu').click();
  await page.getByTestId('bl-menu-time').click();
  await expect(page).toHaveURL(/\/recommend\?time=short$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Подскажи' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Короткая/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Начать играть/ }) })).toHaveCount(1);
  expect(calls).toContain('short');
  await expect(page.getByRole('dialog', { name: 'Сколько есть времени?' })).toHaveCount(0);
});
