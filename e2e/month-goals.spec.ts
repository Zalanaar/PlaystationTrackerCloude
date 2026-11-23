// Цели месяца на главной: выбор игр, подсказка часов, прогресс, снятие. Без цели по трофеям. API эмулируется.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

type GoalGame = { id: number; title: string; coverUrl: string | null; completed: boolean };
type Goals = {
  month: string; year: number; monthNum: number;
  goals: { games: number | null; hours: number | null; trophies: number | null };
  progress: { games: number; hours: number; trophies: number };
  hasGoals: boolean;
  picked: GoalGame[];
  candidates: { playing: GoalGame[]; plan: GoalGame[] };
  hoursHint: number | null;
};

const GTA: GoalGame = { id: 3, title: 'GTA', coverUrl: null, completed: false };
const PLAN: GoalGame = { id: 9, title: 'PlanA', coverUrl: null, completed: false };

const EMPTY: Goals = {
  month: '2026-11', year: 2026, monthNum: 11,
  goals: { games: null, hours: null, trophies: null },
  progress: { games: 0, hours: 5, trophies: 12 },
  hasGoals: false,
  picked: [],
  candidates: { playing: [GTA], plan: [PLAN] },
  hoursHint: 15,
};

async function open(page: Page, baseURL: string, initial: Goals = EMPTY) {
  const current: Goals = structuredClone(initial);
  const puts: unknown[] = [];
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/me\/goals(\?|$)/, async (r) => {
    if (r.request().method() === 'PUT') {
      const b = r.request().postDataJSON() as Goals['goals'] & { gameIds?: number[] };
      puts.push(b);
      const catalog = [...current.picked, ...current.candidates.playing, ...current.candidates.plan];
      if (b.gameIds) {
        const order = new Map(b.gameIds.map((id, i) => [id, i]));
        current.picked = catalog.filter((g) => order.has(g.id)).sort((a, b2) => (order.get(a.id) ?? 0) - (order.get(b2.id) ?? 0));
        current.candidates = {
          playing: current.candidates.playing.filter((g) => !order.has(g.id)),
          plan: current.candidates.plan.filter((g) => !order.has(g.id)),
        };
        current.goals.games = b.gameIds.length ? b.gameIds.length : null;
      } else {
        current.goals.games = b.games ?? null;
      }
      current.goals.hours = b.hours ?? null;
      current.goals.trophies = b.trophies ?? null;
      current.hasGoals = current.goals.games != null || current.goals.hours != null || current.picked.length > 0;
      current.progress = { ...current.progress, games: current.picked.filter((g) => g.completed).length };
    }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: current }) });
  });
  await page.goto('/');
  return { puts };
}

test.describe('Цели месяца на главной', () => {
  test('пустое состояние, выбрать игру и подставить средние часы', async ({ page, baseURL }) => {
    const { puts } = await open(page, baseURL!);
    const card = page.getByTestId('month-goals');
    await expect(card.getByRole('heading', { name: 'Цели на ноябрь' })).toBeVisible();
    await expect(card.getByText(/Выбери игры, которые хочешь пройти/i)).toBeVisible();
    await card.getByTestId('month-goals-set').click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('month-goals-input-trophies')).toHaveCount(0);
    await expect(dialog.getByText('Играю')).toBeVisible();
    await expect(dialog.getByTestId('month-goals-game-9')).toBeVisible();
    await dialog.getByTestId('month-goals-game-3').click();
    await dialog.getByTestId('month-goals-hours-hint').click();
    await expect(dialog.getByTestId('month-goals-input-hours')).toHaveValue('15');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toHaveCount(0);
    expect(puts).toEqual([{ games: null, hours: 15, trophies: null, gameIds: [3] }]);
    await expect(card.getByTestId('month-goals-games')).toContainText('0 из 1 игры');
    await expect(card.getByTestId('month-goals-picked')).toContainText('GTA');
    await expect(card.getByTestId('month-goals-hours')).toContainText('5 из 15 ч');
    await expect(card.getByTestId('month-goals-trophies')).toHaveCount(0);
  });

  test('изменить и убрать цели', async ({ page, baseURL }) => {
    const start: Goals = {
      ...EMPTY,
      goals: { games: 1, hours: 20, trophies: null },
      picked: [{ ...GTA, completed: true }],
      candidates: { playing: [], plan: [PLAN] },
      progress: { games: 1, hours: 5, trophies: 12 },
      hasGoals: true,
    };
    const { puts } = await open(page, baseURL!, start);
    const card = page.getByTestId('month-goals');
    await expect(card.getByTestId('month-goals-games')).toContainText('1 из 1 игры');
    await expect(card.getByTestId('month-goals-picked')).toContainText('GTA');
    await card.getByRole('button', { name: 'Изменить цели' }).click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await dialog.getByTestId('month-goals-clear').click();
    await expect(dialog).toHaveCount(0);
    expect(puts.at(-1)).toEqual({ games: null, hours: null, trophies: null, gameIds: [] });
    await expect(card.getByTestId('month-goals-set')).toBeVisible();
  });
});
