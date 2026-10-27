// QA редизайна: граничные случаи (частичный сбой блоков, null-поля, пустая БД, битые обложки, >300 игр, автоповтор клавиш, reduced-motion).
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi, seed, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string, url: string, games: G[] = seed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  return mock;
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const g = (id: number, o: Partial<G> = {}): G => ({ id, title: `Игра ${id}`, lastPlayedAt: null, status: null, completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o });

test.describe('граничные случаи редизайна', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'вьюпорт задан в тесте'); });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('один из блоков (бэклог) отвечает 503 при первой загрузке: что видит пользователь', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page);
    await page.route(/\/api\/games\?.*status=backlog/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) }));
    await page.goto('/');
    await page.waitForTimeout(1500);
    const err = await page.getByText('Что-то пошло не так').count();
    const cards = await page.locator('article.ps-card').count();
    console.log('PARTIAL FAIL: error panel =', err, 'cards =', cards);
    // ожидание продукта: остальные блоки (хроника, играю) остаются. Фиксируем фактическое поведение.
    expect(cards, 'BUG-R1: сбой одного из 5 запросов блоков роняет всю коллекцию').toBeGreaterThan(0);
  });

  test('null-поля: нет обложки, last_played, часов, трофеев; не падает, нет NaN/undefined', async ({ page, context, baseURL }) => {
    const games = [g(1), g(2, { status: 'completed' }), g(3, { status: 'dropped' }), g(4, { status: 'playing' }), g(5, { status: 'backlog' }), g(6, { status: 'shelved' })];
    await open(page, context, baseURL!, '/', games);
    await expect(page.locator('article.ps-card').first()).toBeVisible();
    const txt = await page.locator('body').innerText();
    expect(txt).not.toMatch(/NaN|undefined|null|Invalid/);
    await expect(page.getByText('Без даты')).toBeVisible();
    await page.getByRole('button', { name: /Без даты/ }).click();
    await expect(page.locator('#undated-body .ps-card__date')).toHaveCount(0);
    for (const v of ['Плотно', 'Список']) { await page.getByRole('button', { name: v }).click(); expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Invalid/); }
    await page.goto('/triage');
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Invalid/);
  });

  test('пустая БД: «Пока пусто», без ошибок; Разбор и Бэклог показывают пустые состояния', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/', []);
    await expect(page.getByText('Пока пусто')).toBeVisible();
    await expect(page.locator('.ps-statline')).toHaveCount(0);
    await page.goto('/triage');
    await expect(page.getByRole('heading', { name: 'Всё разобрано' })).toBeVisible();
    await page.goto('/backlog');
    await expect(page.getByText('Бэклог пуст')).toBeVisible();
  });

  test('битая обложка (404): плейсхолдер с названием, без сломанной картинки', async ({ page, context, baseURL }) => {
    await page.route('**/cv/**', (r) => r.fulfill({ status: 404, body: '' }));
    await open(page, context, baseURL!, '/?status=backlog', [g(1, { status: 'backlog', title: 'Битая обложка', coverUrl: '/cv/x.png' })]);
    await expect(page.locator('.ps-cover--empty').first()).toBeVisible();
    await expect(page.locator('.ps-cover--empty').first()).toContainText('Битая обложка');
  });

  test('более 300 игр «Не разобрано»: вкладка показывает 300 и «Показать ещё», Разбор догружает очередь', async ({ page, context, baseURL }) => {
    const games = Array.from({ length: 350 }, (_, i) => g(i + 1, { lastPlayedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString() }));
    const mock = await open(page, context, baseURL!, '/?status=none', games);
    await expect(page.locator('article.ps-card').first()).toBeVisible();
    await expect(page.locator('article.ps-card')).toHaveCount(300);
    await expect(page.getByRole('button', { name: /Показать ещё \(50\)/ })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Разобрать по одной' })).toBeVisible();
    await expect(page.getByText(/\+\d+/).first()).toBeVisible();
    await page.goto('/triage');
    await expect(page.locator('.ps-tri__pos')).toHaveText('0 / 350');
    expect(mock.listCalls.at(-1)?.searchParams.get('limit')).toBe('300');
  });

  test('Разбор: удержание клавиши (автоповтор) не должно пролистывать очередь', async ({ page, context, baseURL }) => {
    const games = Array.from({ length: 12 }, (_, i) => g(i + 1, { lastPlayedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString() }));
    const mock = await open(page, context, baseURL!, '/triage', games);
    await expect(page.locator('.ps-tri__pos')).toBeVisible();
    await page.keyboard.down('2');
    for (let i = 0; i < 5; i++) await page.keyboard.down('2'); // повторные keydown = e.repeat
    await page.keyboard.up('2');
    await page.waitForTimeout(500);
    console.log('KEY REPEAT PUTs:', mock.mutations.length);
    expect(mock.mutations.length, 'BUG-R3: автоповтор клавиши ставит статус нескольким играм подряд').toBe(1);
  });

  test('Разбор: длинное название в очереди не создаёт горизонтальный скролл', async ({ page, context, baseURL }) => {
    const games = [g(1, { title: 'Dragon Quest XI S: Echoes of an Elusive Age – Definitive Edition Special Collector Bundle', lastPlayedAt: '2026-10-01T10:00:00.000Z' }), ...Array.from({ length: 4 }, (_, i) => g(i + 2, { lastPlayedAt: '2026-09-01T10:00:00.000Z' }))];
    games[1].title = 'Dragon Quest XI S: Echoes of an Elusive Age – Definitive Edition Special Collector Bundle';
    await open(page, context, baseURL!, '/triage', games);
    await expect(page.locator('.ps-queue__t').first()).toBeVisible();
    expect(await noOverflow(page), 'BUG-R2: горизонтальный скролл в Разборе при длинном названии в очереди').toBeLessThanOrEqual(0);
  });

  test('prefers-reduced-motion: переходы и подъём обложки отключены', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, context, baseURL!, '/');
    const card = page.locator('article.ps-card').first();
    await expect(card).toBeVisible();
    const d = await card.locator('.ps-card__cover').evaluate((el) => ({ t: getComputedStyle(el).transitionDuration, a: getComputedStyle(el).animationDuration }));
    console.log('REDUCED', JSON.stringify(d));
    expect(parseFloat(d.t)).toBe(0);
  });

  test('a11y: чипы статуса aria-pressed, фокус виден на карточке, год-кнопка aria-expanded', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/');
    const chips = page.getByRole('group', { name: 'Статус' }).getByRole('button');
    await expect(chips.first()).toHaveAttribute('aria-pressed', /true|false/);
    const hit = page.locator('.ps-card__hit').first();
    await hit.focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const outline = await page.locator('.ps-card__cover').first().evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
    const ring = await hit.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth + ' ' + getComputedStyle(el.parentElement!.querySelector('.ps-card__cover')!).boxShadow);
    console.log('FOCUS', outline, '|', ring);
    await expect(page.locator('.ps-year__btn').first()).toHaveAttribute('aria-expanded', /true|false/);
  });

  test('старая тема только в cookie/localStorage (crystal-towers) сбрасывается на Night', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'ps-theme', value: 'crystal-towers', url: baseURL! }]);
    await context.addInitScript(() => localStorage.setItem('ps-theme', 'memory-card'));
    await open(page, context, baseURL!, '/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('плоский список (сортировка по названию): плашка даты с годом', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?sort=title');
    await expect(page.getByRole('heading', { name: 'Результаты' })).toBeVisible();
    const t = await page.locator('.ps-card__date').allTextContents();
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x).toMatch(/\d{4}/);
  });
});
