// Фазы 16-17 (контракт 20): баннер «синк не запускался», копия разметки, «Подскажи» без вызовов LLM, «Редкие трофеи» с сервисами.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const THIS_YEAR = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const bad = (status: number, code: string, details?: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x', details } }) });

async function setup(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  return mockApi(page);
}

function stats(u: URL, withService: boolean) {
  const year = Number(u.searchParams.get('year') ?? THIS_YEAR);
  const g = { id: 1, title: 'Игра Один', coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: `${THIS_YEAR}-03-10T10:00:00.000Z`, status: 'completed', completedAt: `${THIS_YEAR}-03-10T10:00:00.000Z`, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }] };
  const r = (id: number, name: string) => ({ setId: 1, trophyId: id, type: 'gold', name, detail: null, iconUrl: null, earnedAt: `${THIS_YEAR}-03-02T19:10:00.000Z`, earnedRate: 1.5, rarity: 0, setName: 'X', game: null });
  const list = withService ? [r(1, 'Из сервиса'), r(2, 'Обычный')] : [r(2, 'Обычный')];
  return {
    period: { type: 'year', year, month: null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [THIS_YEAR], header: { completed: 1, dropped: 0, hours: 50, platinum: 1 },
    hours: { byMonth: Array(12).fill(null).map((_, i) => (i < 3 ? 10 : null)), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: `${THIS_YEAR}-01-15`, periodPartial: false },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 3, gameIds: [1] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null } } },
    top: { byHours: [{ game: g, hours: 12.5, estimated: false }], byTrophies: [] },
    rareTrophies: { period: list, allTime: list },
    trophies: { counts: { platinum: 1, gold: 1, silver: 1, bronze: 1, total: 4 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: { 1: g }, groups: [{ month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 0, items: [{ gameId: 1, hours: 12.5, estimated: false, finished: 'completed', finishedAt: `${THIS_YEAR}-03-10T10:00:00.000Z` }] }] },
  };
}

test.describe('Баннер «синк не запускался»', () => {
  test('показывается при overdue.isOverdue, скрывается крестиком; без overdue его нет', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.syncStatus = { ...m.syncStatus, overdue: { isOverdue: true, ageHours: 53.2, thresholdHours: 30 } };
    await page.goto('/');
    const b = page.getByTestId('overdue-banner');
    await expect(b).toContainText('Синк не запускался уже 53 ч (порог 30 ч)');
    await b.getByRole('button', { name: 'Скрыть сообщение' }).click();
    await expect(b).toHaveCount(0);
  });
  test('не заменяет баннер устаревшего NPSSO: показываются оба', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.syncStatus = { ...m.syncStatus, psnAuth: 'auth_expired', overdue: { isOverdue: true, ageHours: 80, thresholdHours: 30 } };
    await page.goto('/');
    await expect(page.getByText('токен доступа к PSN устарел')).toBeVisible();
    await expect(page.getByTestId('overdue-banner')).toContainText('3 дня');
  });
  test('isOverdue=false: баннера нет', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.syncStatus = { ...m.syncStatus, overdue: { isOverdue: false, ageHours: 5, thresholdHours: 30 } };
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId('overdue-banner')).toHaveCount(0);
  });
});

const PREVIEW = {
  mode: 'preview', applied: false, schemaVersion: 1, fileCreatedAt: '2026-10-29T06:00:00.000Z',
  sections: {
    status: { add: 1, change: 1, unchanged: 5, skipped: 1 }, duration: { add: 0, change: 0, unchanged: 2, skipped: 0 }, genres: { add: 0, change: 0, unchanged: 0, skipped: 0 },
    hidden: { add: 0, change: 0, unchanged: 0, skipped: 0 }, roadmapOrder: { add: 0, change: 0, unchanged: 0, skipped: 0 }, roadmapExcluded: { add: 0, change: 0, unchanged: 0, skipped: 0 },
    monthExclusions: { add: 0, change: 0, unchanged: 0, skipped: 0 }, plannedGames: { add: 0, change: 0, unchanged: 0, skipped: 0 }, roadmapSettings: { add: 0, change: 0, unchanged: 0, skipped: 0 },
  },
  changes: [{ section: 'status', kind: 'change', titleId: 'PPSA01234_00', name: 'Hades', from: 'backlog', to: 'completed' }],
  changesTruncated: false, missing: [{ titleId: 'CUSA99999_00', name: 'Old game' }], backupId: null,
};
/** Пункты меню профиля: на десктопе поповер (menuitem), на мобильном окно «Меню» (обычные ссылки и кнопки). */
async function openProfileMenu(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) await page.getByRole('button', { name: 'Меню', exact: true }).click();
  else await page.getByRole('button', { name: 'Меню профиля' }).click();
  return {
    download: mobile ? page.getByRole('link', { name: 'Скачать копию' }) : page.getByRole('menuitem', { name: 'Скачать копию' }),
    restore: mobile ? page.getByRole('button', { name: 'Восстановить из файла' }) : page.getByRole('menuitem', { name: 'Восстановить из файла' }),
  };
}
const FILE = { app: 'ps-tracker-backup', schemaVersion: 1, createdAt: '2026-10-29T06:00:00.000Z', games: [], plannedGames: [], roadmapSettings: null };

test.describe('Копия разметки в меню профиля', () => {
  test('скачать: ссылка на /api/backup; восстановить: файл, preview, подтверждение, apply', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    const calls: string[] = [];
    await page.route('**/api/backup/restore', (r) => {
      const b = r.request().postDataJSON() as { mode: string };
      calls.push(b.mode);
      return r.fulfill(ok(b.mode === 'apply' ? { ...PREVIEW, mode: 'apply', applied: true, backupId: 12 } : PREVIEW));
    });
    await page.goto('/');
    const menu = await openProfileMenu(page);
    await expect(menu.download).toHaveAttribute('href', '/api/backup');
    await menu.restore.click();
    const dlg = page.getByRole('dialog', { name: 'Восстановить из файла' });
    await dlg.getByLabel('Файл копии').setInputFiles({ name: 'ps-tracker-backup-2026-10-29.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(FILE)) });
    await expect(dlg).toContainText('Будет применено: 2 изменения');
    await expect(dlg.getByRole('table')).toContainText('Статусы игр');
    await dlg.getByText(/Список изменений/).click();
    await expect(dlg).toContainText('Hades');
    await expect(dlg).toContainText('бэклог → пройдено');
    await expect(dlg).toContainText('Old game');
    expect(calls).toEqual(['preview']);
    await dlg.getByRole('button', { name: 'Восстановить', exact: true }).click();
    await expect(dlg).toContainText('Готово');
    await expect(dlg).toContainText('№ 12');
    expect(calls).toEqual(['preview', 'apply']);
  });
  test('ошибки: не JSON и unsupported_version по-русски', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.route('**/api/backup/restore', (r) => r.fulfill(bad(400, 'invalid_request', { reason: 'unsupported_version', supported: [1], got: 2 })));
    await page.goto('/');
    await (await openProfileMenu(page)).restore.click();
    const dlg = page.getByRole('dialog', { name: 'Восстановить из файла' });
    await dlg.getByLabel('Файл копии').setInputFiles({ name: 'a.json', mimeType: 'application/json', buffer: Buffer.from('не json') });
    await expect(dlg.getByRole('alert')).toContainText('не JSON');
    await dlg.getByLabel('Файл копии').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"x"}') });
    await expect(dlg.getByRole('alert')).toContainText('версия файла копии не поддерживается');
  });
});

test.describe('Подскажи после 16.4', () => {
  const rec = (llmPending: number) => ({
    items: [{ game: { id: 1, name: 'Хейдес', imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 22.5, hoursSource: 'hltb' }, score: 4.7, signals: [], reason: { text: 'Фраза.', source: 'template' } }],
    meta: { llm: 'ok', candidates: 37, time: 'any', llmPending },
  });
  test('llmPending > 0: пометка про ночной синк; 0: нет', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.route(/\/api\/recommend\/dislikes$/, (r) => r.fulfill(ok({ items: [], ttlDays: 30 })));
    let pending = 3;
    await page.route(/\/api\/recommend(\?.*)?$/, (r) => r.fulfill(ok(rec(pending))));
    await page.goto('/recommend');
    await expect(page.getByTestId('rec-pending')).toContainText('Часть фраз появится после ночного синка');
    pending = 0;
    await page.goto('/recommend');
    await expect(page.getByText('Из 37 игр бэклога')).toBeVisible();
    await expect(page.getByTestId('rec-pending')).toHaveCount(0);
  });
});

test.describe('Редкие трофеи: игры-сервисы', () => {
  test('по умолчанию без withService; переключатель добавляет withService=1', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    const urls: URL[] = [];
    await page.route(/\/api\/stats\?/, (r) => {
      const u = new URL(r.request().url());
      urls.push(u);
      return r.fulfill(ok(stats(u, u.searchParams.get('withService') === '1')));
    });
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Редкие трофеи' });
    const sw = panel.getByLabel('С играми-сервисами');
    await expect(sw).not.toBeChecked();
    await expect(panel.locator('.ps-rare__row')).toHaveCount(1);
    expect(urls[0].searchParams.has('withService')).toBe(false);
    await sw.check();
    await expect(panel.locator('.ps-rare__row')).toHaveCount(2);
    expect(urls.at(-1)?.searchParams.get('withService')).toBe('1');
  });
});
