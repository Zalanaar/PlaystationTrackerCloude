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
  candidates: { playing: GoalGame[]; planMonth: GoalGame[]; plan: GoalGame[]; backlog: GoalGame[] };
  hoursHint: number | null;
  yearGoal: { mode: 'complete' | 'backlog_to'; year: number; current: number; count: number; gamesHint: number | null } | null;
};

const GTA: GoalGame = { id: 3, title: 'GTA', coverUrl: null, completed: false };
const PLAN: GoalGame = { id: 9, title: 'PlanA', coverUrl: null, completed: false };

const EMPTY: Goals = {
  month: '2026-11', year: 2026, monthNum: 11,
  goals: { games: null, hours: null, trophies: null },
  progress: { games: 0, hours: 5, trophies: 12 },
  hasGoals: false,
  picked: [],
  candidates: { playing: [GTA], planMonth: [], plan: [PLAN], backlog: [] },
  hoursHint: 15,
  yearGoal: null,
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
      const catalog = [...current.picked, ...current.candidates.playing, ...current.candidates.planMonth, ...current.candidates.plan, ...current.candidates.backlog];
      if (b.gameIds) {
        const order = new Map(b.gameIds.map((id, i) => [id, i]));
        current.picked = catalog.filter((g) => order.has(g.id)).sort((a, b2) => (order.get(a.id) ?? 0) - (order.get(b2.id) ?? 0));
        current.candidates = {
          playing: current.candidates.playing.filter((g) => !order.has(g.id)),
          planMonth: current.candidates.planMonth.filter((g) => !order.has(g.id)),
          plan: current.candidates.plan.filter((g) => !order.has(g.id)),
          backlog: current.candidates.backlog.filter((g) => !order.has(g.id)),
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
    await expect(card.getByTestId('month-goals-year')).toHaveCount(0);
    await expect(card.getByText(/Выбери игры, которые хочешь пройти/i)).toBeVisible();
    await card.getByTestId('month-goals-set').click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('month-goals-input-trophies')).toHaveCount(0);
    await expect(dialog.getByTestId('month-goals-picks').getByText('Играю', { exact: true })).toBeVisible();
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
      candidates: { playing: [], planMonth: [], plan: [PLAN], backlog: [] },
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

  test('цель года: «Год: 7 из 12» ведёт в План, подсказка темпа в форме', async ({ page, baseURL }) => {
    await open(page, baseURL!, {
      ...EMPTY,
      yearGoal: { mode: 'complete', year: 2026, current: 7, count: 12, gamesHint: 3 },
    });
    const card = page.getByTestId('month-goals');
    const year = card.getByTestId('month-goals-year');
    await expect(year).toHaveText('Год: 7 из 12');
    await expect(year).toHaveAttribute('href', '/roadmap#rm-goal');
    await card.getByTestId('month-goals-set').click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await expect(dialog.getByTestId('month-goals-games-hint')).toHaveText('По темпу года — 3 игры в месяц');
  });

  test('в листе есть «В плане на ноябрь», «План», «Бэклог» и поиск по бэклогу', async ({ page, baseURL }) => {
    const nov: GoalGame = { id: 11, title: 'Nov Game', coverUrl: null, completed: false };
    const backlog = Array.from({ length: 8 }, (_, i) => ({ id: 20 + i, title: `Back ${i + 1}`, coverUrl: null, completed: false }));
    await open(page, baseURL!, {
      ...EMPTY,
      candidates: { playing: [GTA], planMonth: [nov], plan: [PLAN], backlog },
    });
    await page.getByTestId('month-goals-set').click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await expect(dialog.getByText('В плане на ноябрь', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('month-goals-game-11')).toBeVisible();
    await expect(dialog.getByTestId('month-goals-picks').getByText('План', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('month-goals-picks').getByText('Бэклог', { exact: true })).toBeVisible();
    const search = dialog.getByTestId('month-goals-search');
    await expect(search).toBeVisible();
    await search.fill('Back 3');
    await expect(dialog.getByTestId('month-goals-game-22')).toBeVisible();
    await expect(dialog.getByTestId('month-goals-game-20')).toHaveCount(0);
    await dialog.getByTestId('month-goals-game-22').click();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('month-goals-picked')).toContainText('Back 3');
  });

  test('бэклог и план: 10 строк, раскрытие, поиск по всему списку; футер не перекрывает игры', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const backlog = Array.from({ length: 15 }, (_, i) => ({ id: 20 + i, title: `Back ${i + 1}`, coverUrl: null, completed: false }));
    const plan = Array.from({ length: 12 }, (_, i) => ({ id: 40 + i, title: `Plan ${i + 1}`, coverUrl: null, completed: false }));
    await open(page, baseURL!, {
      ...EMPTY,
      candidates: { playing: [GTA], planMonth: [{ id: 11, title: 'Nov Game', coverUrl: null, completed: false }], plan, backlog },
    });
    await page.getByTestId('month-goals-set').click();
    const dialog = page.getByRole('dialog', { name: 'Цели на ноябрь' });
    await expect(dialog.getByTestId('month-goals-picks').getByText('Играю', { exact: true })).toBeVisible();
    await expect(dialog.getByText('В плане на ноябрь', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('month-goals-game-11')).toBeAttached();

    await expect(dialog.getByTestId('month-goals-game-40')).toBeAttached();
    await expect(dialog.getByTestId('month-goals-game-49')).toBeAttached();
    await expect(dialog.getByTestId('month-goals-game-50')).toHaveCount(0);
    await expect(dialog.getByTestId('month-goals-more-plan')).toHaveText(/Показать ещё 2/);
    await expect(dialog.getByTestId('month-goals-all-plan')).toHaveText('Показать все (12)');

    await expect(dialog.getByTestId('month-goals-game-20')).toBeAttached();
    await expect(dialog.getByTestId('month-goals-game-29')).toBeAttached();
    await expect(dialog.getByTestId('month-goals-game-30')).toHaveCount(0);
    await expect(dialog.getByTestId('month-goals-more-backlog')).toHaveText(/Показать ещё 5/);
    await expect(dialog.getByTestId('month-goals-all-backlog')).toHaveText('Показать все (15)');

    const search = dialog.getByTestId('month-goals-search');
    await search.fill('Back 15');
    await expect(dialog.getByTestId('month-goals-game-34')).toBeVisible();
    await expect(dialog.getByTestId('month-goals-game-20')).toHaveCount(0);
    await expect(dialog.getByTestId('month-goals-more-backlog')).toHaveCount(0);

    await search.fill('');
    await expect(dialog.getByTestId('month-goals-game-30')).toHaveCount(0);
    await dialog.getByTestId('month-goals-all-backlog').click();
    await expect(dialog.getByTestId('month-goals-game-34')).toBeAttached();
    await expect(dialog.getByTestId('month-goals-collapse-backlog')).toBeVisible();
    await dialog.getByTestId('month-goals-collapse-backlog').click();
    await expect(dialog.getByTestId('month-goals-game-34')).toHaveCount(0);

    await dialog.getByTestId('month-goals-more-backlog').click();
    await expect(dialog.getByTestId('month-goals-game-34')).toBeAttached();
    await expect(dialog.getByTestId('month-goals-collapse-backlog')).toBeVisible();

    const body = dialog.locator('.ps-mgoals-form__body');
    const footer = dialog.getByTestId('month-goals-footer');
    await expect(footer.getByRole('button', { name: 'Сохранить' })).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });

    const peek = await dialog.evaluate((root) => {
      const bodyEl = root.querySelector('.ps-mgoals-form__body');
      const foot = root.querySelector('[data-testid="month-goals-footer"]');
      if (!bodyEl || !foot) return [{ error: 'no body/footer' }];
      const br = bodyEl.getBoundingClientRect();
      const fr = foot.getBoundingClientRect();
      const hits = [];
      for (const row of root.querySelectorAll('.ps-mgoals-pick__btn')) {
        const r = row.getBoundingClientRect();
        const top = Math.max(r.top, br.top);
        const bottom = Math.min(r.bottom, br.bottom);
        if (bottom <= top + 0.5) continue;
        if (bottom > fr.top + 1 && top < fr.bottom - 1) {
          hits.push({ title: (row.textContent || '').trim(), bottom, footTop: fr.top });
        }
      }
      if (fr.top < br.bottom - 1 && fr.bottom <= br.bottom) {
        hits.push({ title: 'FOOTER_INSIDE_BODY', bottom: fr.bottom, footTop: fr.top });
      }
      return hits;
    });
    expect(peek, JSON.stringify(peek)).toEqual([]);
  });
});
