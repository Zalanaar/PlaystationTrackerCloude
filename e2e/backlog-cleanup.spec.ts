// Идея 5 (аудит UX): «Чистка бэклога» — игры старше 2 лет в бэклоге и меньше часа наиграно, по одной; итог «−N ч из бэклога».
import { createRequire } from 'node:module';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi, seed, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: null, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});

function games(): G[] {
  return [
    ...seed(),
    bl(30, 'Old Long', { hltbHours: 100, hltbChecked: true, coverUrl: 'https://image.api.playstation.com/cdn/30.png' }),
    bl(31, 'Old Short', { hltbHours: 20, hltbChecked: true, playSeconds: 1200, playCount: 1, coverUrl: 'https://image.api.playstation.com/cdn/31.png' }),
    bl(32, 'Old Unknown', { coverUrl: 'https://image.api.playstation.com/cdn/32.png' }),
  ];
}

async function open(page: Page, context: BrowserContext, baseURL: string, url: string): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, games());
  m.backlogAge = {
    items: [
      { gameId: 6, since: ago(100), source: 'status', playSeconds: 600 },
      { gameId: 30, since: ago(1500), source: 'status', playSeconds: 0 },
      { gameId: 31, since: ago(900), source: 'played', playSeconds: 1200 },
      { gameId: 32, since: ago(800), source: 'status', playSeconds: 0 },
    ],
    summary: { count: 4, medianDays: 850, overYear: 3, cleanup: 3, oldest: { gameId: 30, title: 'Old Long', since: ago(1500) } },
  };
  await page.goto(url);
  return m;
}

test('Бэклог → «Чистка»: отложить, бросить, оставить; «Отменить последнее»; итог в часах', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string, '/backlog');
  const link = page.getByTestId('bl-cleanup');
  await expect(link).toHaveText('Чистка: 3 игры');
  await link.click();
  await expect(page).toHaveURL(/\/triage\?mode=cleanup/);
  await expect(page.getByRole('heading', { level: 1, name: 'Разбор' })).toBeAttached();
  await expect(page.getByRole('group', { name: 'Какие игры разбирать' }).getByRole('button', { name: /Чистка 3/ })).toHaveAttribute('aria-pressed', 'true');

  const card = page.getByTestId('cleanup-card');
  await expect(card).toHaveAttribute('aria-label', 'Old Long'); // дольше всех ждёт — первой
  await expect(card).toHaveAttribute('data-game-id', '30');
  await expect(card.locator('img')).toHaveAttribute('src', 'https://image.api.playstation.com/cdn/30.png?w=360');
  // следующие обложки — тот же URL, что у карточки (LARGE_W), уже в preload
  await expect(page.locator('link[data-cover-preload]')).toHaveCount(2);
  await expect(page.locator('link[data-cover-preload][href="https://image.api.playstation.com/cdn/31.png?w=360"]')).toHaveCount(1);
  await expect(page.locator('link[data-cover-preload][href="https://image.api.playstation.com/cdn/32.png?w=360"]')).toHaveCount(1);
  await expect(page.getByTestId('cleanup-progress')).toHaveText('1 из 3');
  await expect(card).toContainText('В бэклоге 4 г.');
  await expect(card).toContainText('не запускалась');

  await page.evaluate(createRequire(import.meta.url)('axe-core').source as string);
  const v = await page.evaluate(async () => {
    const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await ax.run('[data-testid="cleanup"]', { resultTypes: ['violations'] });
    return r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')}`));
  });
  expect(v).toEqual([]);

  await page.getByTestId('cleanup-shelve').click();
  await expect(card).toHaveAttribute('aria-label', 'Old Short');
  await expect(card).toHaveAttribute('data-game-id', '31');
  await expect(card.locator('img')).toHaveAttribute('src', 'https://image.api.playstation.com/cdn/31.png?w=360');
  expect(m.games.find((g) => g.id === 30)?.status).toBe('shelved');
  await expect(page.getByTestId('cleanup-sofar')).toHaveText('−100 ч из бэклога');

  // «Отменить последнее»: игра снова в бэклоге и снова на экране
  await page.getByTestId('cleanup-undo').click();
  await expect(card).toHaveAttribute('aria-label', 'Old Long');
  await expect.poll(() => m.games.find((g) => g.id === 30)?.status).toBe('backlog');

  await page.getByTestId('cleanup-shelve').click();
  await expect(card).toHaveAttribute('aria-label', 'Old Short');
  await page.getByTestId('cleanup-drop').click();
  await expect(card).toHaveAttribute('aria-label', 'Old Unknown');
  await page.getByTestId('cleanup-keep').click();

  const done = page.getByTestId('cleanup-done');
  await expect(done).toContainText(/−1\d\d ч из бэклога/);
  await expect(done).toContainText('Разобрано 3: отложено 1, брошено 1, оставлено 1');
  expect(m.games.find((g) => g.id === 31)?.status).toBe('dropped');
  expect(m.games.find((g) => g.id === 32)?.status).toBe('backlog');
});

test('нечего чистить: пустое состояние со ссылкой в бэклог, ссылки на Бэклоге нет', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string, '/backlog');
  void m;
  await page.unroute(/\/api\/collection\/backlog-age(\?|$)/);
  await page.route(/\/api\/collection\/backlog-age(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], summary: { count: 0, medianDays: null, overYear: 0, cleanup: 0, oldest: null } } }) }));
  await page.goto('/backlog/cleanup');
  await expect(page).toHaveURL(/\/triage\?mode=cleanup/);
  await expect(page.getByText('Чистить нечего')).toBeVisible();
  await page.goto('/backlog');
  await expect(page.getByTestId('bl-cleanup')).toHaveCount(0);
});
