// Фаза 11: чипы статуса HLTB и массовая подгрузка длительности (контракт 16.4, 16.7). API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: null, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});
const games = (): G[] => [
  bl(1, 'Альфа Найдена', { hltbHours: 8, hltbName: 'Alpha', hltbChecked: true }),
  bl(2, 'Браво Нет', { hltbChecked: true }),
  bl(3, 'Чарли Ручная Нет', { hltbChecked: true, override: 15 }),
  bl(4, 'Дельта Новая'),
  bl(5, 'Эхо Новая'),
];

const run = (o: Record<string, unknown>) => ({
  data: { processed: 0, found: 0, notFound: 0, failed: 0, remaining: 0, done: false, stopReason: 'budget', warnings: [], ...o },
});

async function open(page: Page, context: BrowserContext, baseURL: string, url = '/backlog'): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games());
  await page.goto(url);
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
  return mock;
}
const titles = (page: Page) => page.locator('.ps-card__title').allTextContents();
const cards = (page: Page) => page.locator('.ps-card:not(.ps-card--sk)');

test.describe('Бэклог: статус HLTB', () => {
  test('чипы со счётчиками, фильтр, URL, сочетание с другими фильтрами', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    await expect(page.getByRole('button', { name: 'Не найдено на HLTB: 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Не проверено: 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Не найдено на HLTB: 2' }).click();
    await expect(page).toHaveURL(/hltb=not_found/);
    // игра с ручной длительностью без совпадения остаётся в not_found
    await expect.poll(() => titles(page)).toEqual(['Браво Нет', 'Чарли Ручная Нет']);
    expect((mock.listCalls.at(-1) as URL).searchParams.get('hltb')).toBe('not_found');
    // ИЛИ внутри параметра и сочетание с длительностью; счётчики hltb не зависят от выбора hltb
    await page.getByRole('button', { name: 'Не проверено: 2' }).click();
    await expect(page).toHaveURL(/hltb=not_found%2Cunchecked/);
    await expect(cards(page)).toHaveCount(4);
    await page.getByRole('button', { name: '10–30 ч: 1' }).click();
    await expect.poll(() => titles(page)).toEqual(['Чарли Ручная Нет']);
    await expect(page).toHaveURL(/duration=10_30/);
    await page.reload();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Не найдено на HLTB: 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('пометка «нет на HLTB» только у not_found, длительность видна', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    const manual = page.locator('.ps-card', { hasText: 'Чарли' }).getByTestId('bl-duration');
    await expect(manual).toContainText('≈ 15 ч');
    await expect(manual).toContainText('вручную');
    await expect(manual.getByTestId('bl-no-hltb')).toHaveText('нет на HLTB');
    await expect(page.locator('.ps-card', { hasText: 'Браво' }).getByTestId('bl-no-hltb')).toBeVisible();
    await expect(page.locator('.ps-card', { hasText: 'Альфа' }).getByTestId('bl-no-hltb')).toHaveCount(0);
    await expect(page.locator('.ps-card', { hasText: 'Дельта' }).getByTestId('bl-no-hltb')).toHaveCount(0);
  });

  test('чип скрыт при нуле, но остаётся, если выбран', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    await mockApi(page, [bl(1, 'Альфа', { hltbHours: 8, hltbName: 'A', hltbChecked: true })]);
    await page.goto('/backlog');
    await cards(page).first().waitFor();
    await expect(page.getByRole('button', { name: /^Не найдено на HLTB/ })).toHaveCount(0);
    await page.goto('/backlog?hltb=not_found');
    await expect(page.getByRole('button', { name: 'Не найдено на HLTB: 0' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Бэклог: подгрузка длительности с HLTB', () => {
  test('цикл budget -> complete: прогресс, итог, обновление списка и счётчиков', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbDelay = 150;
    mock.hltbRuns.push(run({ processed: 1, found: 1, remaining: 1 }), run({ processed: 1, notFound: 1, remaining: 0, done: true, stopReason: 'complete' }));
    mock.hltbApply = (gs, call) => {
      const g = gs.find((x) => x.id === (call === 1 ? 4 : 5)) as G;
      if (call === 1) Object.assign(g, { hltbChecked: true, hltbName: 'Delta', hltbHours: 20 });
      else g.hltbChecked = true;
    };
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-progress')).toContainText('Проверено 1, осталось 1');
    await expect(page.getByRole('button', { name: 'Подтянуть длительность с HLTB' })).toBeDisabled();
    await expect(page.getByTestId('hltb-result')).toContainText('Готово. Проверено 2: найдено 1, не найдено 1, ошибок 0.');
    expect(mock.hltbCalls).toEqual([{}, {}]);
    // список и счётчики перезагружены
    await expect(page.getByRole('button', { name: 'Не найдено на HLTB: 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Не проверено: 0' })).toHaveCount(0);
    await expect(page.locator('.ps-card', { hasText: 'Дельта' }).getByTestId('bl-duration')).toContainText('≈ 20 ч');
  });

  test('«Перепроверить не найденные»: since один и тот же во всех вызовах', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbRuns.push(run({ processed: 2, notFound: 2, remaining: 1 }), run({ processed: 1, notFound: 1, remaining: 0, done: true, stopReason: 'complete' }));
    await page.getByLabel('Перепроверить не найденные').check();
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-result')).toContainText('Проверено 3');
    expect(mock.hltbCalls).toHaveLength(2);
    expect(mock.hltbCalls[0].recheckNotFound).toBe(true);
    expect(typeof mock.hltbCalls[0].since).toBe('string');
    expect(mock.hltbCalls[1]).toEqual(mock.hltbCalls[0]);
  });

  test('«Остановить» прерывает цикл между вызовами', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbDelay = 300;
    for (let i = 0; i < 5; i++) mock.hltbRuns.push(run({ processed: 1, found: 1, remaining: 10 }));
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-progress')).toBeVisible();
    await page.getByRole('button', { name: 'Остановить подгрузку с HLTB' }).click();
    await expect(page.getByTestId('hltb-result')).toContainText('Остановлено.');
    expect(mock.hltbCalls.length).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button', { name: 'Подтянуть длительность с HLTB' })).toBeEnabled();
  });

  test('перепроверка: since = сейчас минус ~60 секунд', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbRuns.push(run({ processed: 1, notFound: 1, remaining: 0, done: true, stopReason: 'complete' }));
    const t0 = Date.now();
    await page.getByLabel('Перепроверить не найденные').check();
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-result')).toContainText('Готово.');
    const since = Date.parse(mock.hltbCalls[0].since as string);
    expect(t0 - since).toBeGreaterThanOrEqual(59_000);
    expect(t0 - since).toBeLessThanOrEqual(75_000);
  });

  test('400 since_in_future: сообщение о часах, без повторов', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbRuns.push({ status: 400, code: 'invalid_request', reason: 'since_in_future' }, run({ processed: 1, remaining: 0, done: true, stopReason: 'complete' }));
    await page.getByLabel('Перепроверить не найденные').check();
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-result')).toHaveText('Часы устройства не совпадают с сервером, перепроверка не запущена.');
    await expect(page.getByRole('button', { name: 'Подтянуть длительность с HLTB' })).toBeEnabled();
    await page.waitForTimeout(300);
    expect(mock.hltbCalls).toHaveLength(1);
  });

  test('«Остановить» прерывает запрос в полёте, без ошибки', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbDelay = 3000;
    mock.hltbRuns.push(run({ processed: 1, found: 1, remaining: 10 }));
    const failed: string[] = [];
    page.on('requestfailed', (r) => { if (r.url().includes('/api/hltb/run')) failed.push(r.failure()?.errorText ?? ''); });
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect.poll(() => mock.hltbCalls.length).toBe(1);
    await page.getByRole('button', { name: 'Остановить подгрузку с HLTB' }).click();
    const res = page.getByTestId('hltb-result');
    await expect(res).toContainText('Остановлено.', { timeout: 2500 });
    await expect(res).toHaveAttribute('data-tone', 'warn');
    await expect(res).not.toContainText('Нет связи');
    await expect.poll(() => failed.length).toBe(1);
    expect(mock.hltbCalls).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Подтянуть длительность с HLTB' })).toBeEnabled();
  });

  test('уход со страницы прерывает запрос в полёте', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbDelay = 3000;
    mock.hltbRuns.push(run({ processed: 1, found: 1, remaining: 10 }));
    const failed: string[] = [];
    page.on('requestfailed', (r) => { if (r.url().includes('/api/hltb/run')) failed.push(r.failure()?.errorText ?? ''); });
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect.poll(() => mock.hltbCalls.length).toBe(1);
    // dispatchEvent: на мобильной вёрстке dev-оверлей Next перехватывает указатель, нужен именно клиентский переход (размонтирование)
    await page.getByRole('link', { name: 'Коллекция' }).first().dispatchEvent('click');
    await expect.poll(() => failed.length, { timeout: 2000 }).toBe(1);
    expect(mock.hltbCalls).toHaveLength(1);
  });

  test('409: синк уже идёт', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbRuns.push({ status: 409, code: 'sync_in_progress' });
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-result')).toHaveText('Синк уже идёт, повторите позже.');
    await expect(page.getByRole('button', { name: 'Подтянуть длительность с HLTB' })).toBeEnabled();
  });

  test('503: база недоступна', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbRuns.push({ status: 503, code: 'db_unavailable' });
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    await expect(page.getByTestId('hltb-result')).toContainText('База данных недоступна');
  });

  test('done при remaining > 0 (errors) и предупреждения failed', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.hltbRuns.push(run({ processed: 1, found: 1, failed: 3, remaining: 4, done: true, stopReason: 'errors', warnings: [{ code: 'hltb_failed', message: 'HLTB не ответил для 3 игр' }] }));
    await page.getByRole('button', { name: 'Подтянуть длительность с HLTB' }).click();
    const res = page.getByTestId('hltb-result');
    await expect(res).toContainText('Остановлено: HLTB несколько раз подряд вернул ошибку');
    await expect(res).toContainText('ошибок 3');
    await expect(res).toContainText('повторите позже');
    await expect(res).toContainText('HLTB не ответил для 3 игр');
    expect(mock.hltbCalls).toHaveLength(1);
  });

  test('мобильная: без горизонтального скролла, кнопка доступна с клавиатуры', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, context, baseURL as string);
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(w.s).toBeLessThanOrEqual(w.c);
    const btn = page.getByRole('button', { name: 'Подтянуть длительность с HLTB' });
    await btn.focus();
    await expect(btn).toBeFocused();
  });
});
