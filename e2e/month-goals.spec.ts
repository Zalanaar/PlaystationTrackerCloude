// Цели месяца на главной: пустое состояние, задание цели, прогресс, снятие. API эмулируется.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

type Goals = {
  month: string; year: number; monthNum: number;
  goals: { games: number | null; hours: number | null; trophies: number | null };
  progress: { games: number; hours: number; trophies: number };
  hasGoals: boolean;
};

const EMPTY: Goals = {
  month: '2026-11', year: 2026, monthNum: 11,
  goals: { games: null, hours: null, trophies: null },
  progress: { games: 1, hours: 5, trophies: 12 },
  hasGoals: false,
};

async function open(page: Page, baseURL: string, initial: Goals = EMPTY) {
  let current: Goals = { ...initial, goals: { ...initial.goals }, progress: { ...initial.progress } };
  const puts: unknown[] = [];
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/me\/goals(\?|$)/, async (r) => {
    if (r.request().method() === 'PUT') {
      const b = r.request().postDataJSON() as Goals['goals'];
      puts.push(b);
      const goals = { games: b.games ?? null, hours: b.hours ?? null, trophies: b.trophies ?? null };
      current = { ...current, goals, hasGoals: goals.games != null || goals.hours != null || goals.trophies != null };
    }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: current }) });
  });
  await page.goto('/');
  return { puts };
}

test.describe('Цели месяца на главной', () => {
  test('пустое состояние, задать цель, увидеть прогресс', async ({ page, baseURL }) => {
    const { puts } = await open(page, baseURL!);
    const card = page.getByTestId('month-goals');
    await expect(card.getByRole('heading', { name: 'Цели на ноябрь' })).toBeVisible();
    await expect(card.getByText(/цель задаёшь сам/i)).toBeVisible();
    await card.getByTestId('month-goals-set').click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('month-goals-input-games').fill('3');
    await dialog.getByTestId('month-goals-input-hours').fill('20');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toHaveCount(0);
    expect(puts).toEqual([{ games: 3, hours: 20, trophies: null }]);
    await expect(card.getByTestId('month-goals-games')).toContainText('1 из 3 игр');
    await expect(card.getByTestId('month-goals-hours')).toContainText('5 из 20 ч');
    await expect(card.getByTestId('month-goals-trophies')).toHaveCount(0);
  });

  test('изменить и убрать цели', async ({ page, baseURL }) => {
    const start: Goals = {
      ...EMPTY,
      goals: { games: 3, hours: 20, trophies: null },
      hasGoals: true,
    };
    const { puts } = await open(page, baseURL!, start);
    const card = page.getByTestId('month-goals');
    await expect(card.getByTestId('month-goals-games')).toContainText('1 из 3 игр');
    await card.getByRole('button', { name: 'Изменить цели' }).click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await dialog.getByTestId('month-goals-clear').click();
    await expect(dialog).toHaveCount(0);
    expect(puts.at(-1)).toEqual({ games: null, hours: null, trophies: null });
    await expect(card.getByTestId('month-goals-set')).toBeVisible();
  });
});
