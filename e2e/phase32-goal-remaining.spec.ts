// Фаза 32 (QA): «осталось ≈ N ч» в Бэклоге и «Цель года» в Плане. API эмулируется (collection-mock, roadmap-mock).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { baseState, goalView, mockRoadmap, type RmState } from './roadmap-mock';
import { signedSession } from './session';

const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, withRemaining: true, ...o,
});
const HOUR = 3600;
const games = (): G[] => [
  bl(1, 'Альфа начата', { hltbHours: 20, hltbName: 'Alpha', hltbChecked: true, playSeconds: 8 * HOUR }), // A: осталось 12, 40%
  bl(2, 'Браво не начата', { hltbHours: 10, hltbName: 'Bravo', hltbChecked: true }), // B: 10, 0%
  bl(3, 'Чарли за оценкой', { hltbHours: 10, hltbName: 'Charlie', hltbChecked: true, playSeconds: 30 * HOUR }), // минимум 15%: 1,5
  bl(4, 'Дельта нет на HLTB', { hltbChecked: true }), // C
  bl(5, 'Эхо ручная', { override: 25, hltbChecked: true, playSeconds: 5 * HOUR }), // 20 вручную
];

async function auth(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
}

test.describe('Бэклог: «осталось»', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
    await mockApi(page, games());
    await page.goto('/backlog');
    await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
    await page.locator('.ps-card:not(.ps-card--sk), .ps-blrow').first().waitFor();
  });
  const meter = (page: Page, t: string) => page.locator('.ps-card, .ps-blrow').filter({ hasText: t }).getByTestId('bl-duration');

  test('A/B/минимум/C/ручная: текст, полоса, пометки', async ({ page }) => {
    await expect(meter(page, 'Альфа')).toContainText('≈ 12 ч');
    await expect(meter(page, 'Альфа').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    await expect(meter(page, 'Браво')).toContainText('≈ 10 ч');
    await expect(meter(page, 'Браво').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    await expect(meter(page, 'Чарли')).toContainText('≈ 1,5 ч');
    await expect(meter(page, 'Чарли')).toContainText('мин. 15%');
    await expect(meter(page, 'Чарли').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85');
    await expect(meter(page, 'Эхо')).toContainText('≈ 20 ч');
    await expect(meter(page, 'Эхо')).toContainText('вручную');
    // C: только метка, ни остатка, ни полосы
    await expect(meter(page, 'Дельта')).toContainText('нет на HLTB');
    await expect(meter(page, 'Дельта')).not.toContainText('осталось');
    await expect(meter(page, 'Дельта').getByRole('progressbar')).toHaveCount(0);
  });

  test('слово «осталось» есть для известного остатка (aria/видимо в списке), 360 и 320 без горизонтального скролла', async ({ page }) => {
    for (const [w, h] of [[360, 640], [320, 568]] as const) {
      await page.setViewportSize({ width: w, height: h });
      expect(await noHScroll(page), `${w}px`).toBe(true);
    }
    await expect(meter(page, 'Альфа').getByRole('progressbar')).toHaveAttribute('aria-label', /осталось ≈ 12 ч/);
  });
});

test.describe('Бэклог: «Список» на мобильном', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('строка списка: «осталось ≈ N ч», минимум текстом, C без полосы', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'мобильный вид по умолчанию');
    await auth(context, baseURL!);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
    await mockApi(page, games());
    await page.goto('/backlog');
    await page.locator('.ps-blrow').first().waitFor();
    const row = (t: string) => page.locator('.ps-blrow').filter({ hasText: t }).getByTestId('bl-duration');
    await expect(row('Альфа')).toContainText('осталось ≈ 12 ч');
    await expect(row('Чарли')).toContainText('мин. 15%');
    await expect(row('Дельта')).toHaveText('нет на HLTB');
    await expect(row('Дельта').getByRole('progressbar')).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
  });
});

async function openPlan(page: Page, context: BrowserContext, baseURL: string, s: RmState): Promise<RmState> {
  await auth(context, baseURL);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await mockApi(page, []);
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  return s;
}
const card = (page: Page) => page.getByTestId('rm-goal-card');

test.describe('План: цель года', () => {
  test('нет goal в ответе (старые фикстуры): пустое состояние, остальной План работает', async ({ page, context, baseURL }) => {
    await openPlan(page, context, baseURL!, baseState());
    await expect(page.getByTestId('rm-goal-empty')).toContainText('Цели на 2026 пока нет');
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(4);
  });

  test('создать, изменить, убрать (с отменой)', async ({ page, context, baseURL }) => {
    const s = await openPlan(page, context, baseURL!, baseState({ goal: null }));
    await page.getByRole('button', { name: 'Поставить цель' }).click();
    const save = page.getByRole('button', { name: 'Сохранить цель' });
    await expect(save).toBeDisabled();
    await page.getByTestId('rm-goal-count').fill('12');
    await save.click();
    await expect(card(page)).toContainText('Пройти 12 игр');
    expect(s.goalCalls).toEqual([{ method: 'PUT', body: { mode: 'complete', count: 12 } }]);
    // изменить: режим «Бэклог до N»
    const editBtn = page.getByRole('button', { name: 'Изменить цель' });
    if (await editBtn.isVisible()) await editBtn.click();
    else { await page.getByRole('button', { name: 'Действия с целью' }).click(); await page.getByRole('menuitem', { name: 'Изменить цель' }).click(); }
    await page.getByTestId('rm-goal-mode-backlog_to').click();
    await page.getByTestId('rm-goal-count').fill('10');
    await page.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(card(page)).toContainText('Бэклог до 10 игр');
    expect(s.goalCalls?.at(-1)).toEqual({ method: 'PUT', body: { mode: 'backlog_to', count: 10 } });
    // убрать + отменить
    if (await page.getByRole('button', { name: 'Убрать цель' }).isVisible()) await page.getByRole('button', { name: 'Убрать цель' }).click();
    else { await page.getByRole('button', { name: 'Действия с целью' }).click(); await page.getByRole('menuitem', { name: 'Убрать цель' }).click(); }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Убрать', exact: true }).click();
    await expect(page.getByTestId('rm-goal-empty')).toBeVisible();
    expect(s.goalCalls?.some((c) => c.method === 'DELETE')).toBe(true);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(card(page)).toContainText('Бэклог до 10 игр');
  });

  test('границы N: 0 для «пройти», 1001, дробное и пустое не сохраняются; «Бэклог до 0» допустим', async ({ page, context, baseURL }) => {
    const s = await openPlan(page, context, baseURL!, baseState({ goal: null }));
    await page.getByRole('button', { name: 'Поставить цель' }).click();
    const save = page.getByRole('button', { name: 'Сохранить цель' });
    const n = page.getByTestId('rm-goal-count');
    for (const bad of ['0', '1001', '2.5', '-3', '']) {
      await n.fill(bad);
      await expect(save, `«${bad}»`).toBeDisabled();
    }
    await n.fill('1000');
    await expect(save).toBeEnabled();
    await page.getByTestId('rm-goal-mode-backlog_to').click();
    await n.fill('0');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(card(page)).toContainText('Бэклог до 0 игр');
    expect(s.goalCalls).toEqual([{ method: 'PUT', body: { mode: 'backlog_to', count: 0 } }]);
  });

  test('409 settings_required: понятное сообщение, цель не появляется', async ({ page, context, baseURL }) => {
    const s = await openPlan(page, context, baseURL!, baseState({ goal: null, goalPutFail: { status: 409, code: 'settings_required' } }));
    await page.getByRole('button', { name: 'Поставить цель' }).click();
    await page.getByTestId('rm-goal-count').fill('5');
    await page.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(page.getByTestId('rm-goal-error')).toContainText('Сначала сохрани настройки плана');
    await expect(card(page)).toHaveCount(0);
    expect(s.goal).toBeNull();
  });

  test('503 при сохранении: ошибка в форме, форма остаётся', async ({ page, context, baseURL }) => {
    await openPlan(page, context, baseURL!, baseState({ goal: null, goalPutFail: { status: 503, code: 'db_unavailable' } }));
    await page.getByRole('button', { name: 'Поставить цель' }).click();
    await page.getByTestId('rm-goal-count').fill('5');
    await page.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(page.getByTestId('rm-goal-error')).toContainText('База данных недоступна');
    await expect(page.getByTestId('rm-goal-count')).toHaveValue('5');
  });

  const cases: [string, Record<string, unknown>, string, string][] = [
    ['ahead', goalView('complete', 8, { status: 'ahead', diff: 1.5, forecast: 9.5, forecastAtYearEnd: 9 }), 'ahead', 'Опережаю на 2 игры'],
    ['onTrack', goalView('complete', 9, { status: 'onTrack', diff: 0.2 }), 'on_track', 'Успеваю'],
    ['behind', goalView('complete', 12), 'behind', 'Отстаю на 3 игры'],
    ['achieved', goalView('complete', 5), 'done', 'Цель выполнена'],
    ['no_data', goalView('complete', 12, { paceEmpty: true, pacePerMonth: 0, current: 0, remaining: 12, status: 'behind', diff: -12, forecast: 0, forecastAtYearEnd: 0 }), 'no_data', 'Пока мало данных'],
    ['backlog behind', goalView('backlog_to', 10), 'behind', 'Отстаю на'],
    ['not_started (будущий год)', goalView('complete', 5, { year: 2027, status: 'not_started', diff: 0, current: 0, remaining: 5 }), 'future_year', 'Цель начнётся 1 янв. 2027'],
  ];
  for (const [name, goal, kind, text] of cases) {
    test(`статус: ${name}`, async ({ page, context, baseURL }) => {
      await openPlan(page, context, baseURL!, baseState({ goal }));
      await expect(card(page)).toHaveAttribute('data-state', kind);
      await expect(page.getByTestId('rm-goal-status')).toContainText(text);
    });
  }

  test('самый длинный текст «Бэклог до 999 игр» без горизонтального скролла на 360 и 320', async ({ page, context, baseURL }) => {
    await openPlan(page, context, baseURL!, baseState({ goal: goalView('backlog_to', 999) }));
    await expect(card(page)).toContainText('Бэклог до 999 игр');
    for (const [w, h] of [[360, 640], [320, 568]] as const) {
      await page.setViewportSize({ width: w, height: h });
      expect(await noHScroll(page), `${w}px`).toBe(true);
      const box = await card(page).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w + 0.5);
    }
  });

  test('7 тем: карточка цели читаема, текст статуса контрастный, без горизонтального скролла', async ({ page, context, baseURL }) => {
    await openPlan(page, context, baseURL!, baseState({ goal: goalView('complete', 12) }));
    for (const th of ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']) {
      await page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, th);
      await expect(card(page)).toBeVisible();
      const ratio = await page.evaluate(() => {
        const lum = (c: string) => {
          const m = c.match(/[\d.]+/g)!.map(Number);
          const [r, g, b] = m.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const el = document.querySelector('[data-testid="rm-goal-status"]')!;
        // фон панели полупрозрачный (color-mix), поэтому сверяем с токеном --surface напрямую
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--surface)';
        document.body.appendChild(probe);
        const bgc = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const a = lum(getComputedStyle(el).color), b = lum(bgc);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(ratio, th).toBeGreaterThanOrEqual(4.5);
      expect(await noHScroll(page), th).toBe(true);
    }
  });
});
