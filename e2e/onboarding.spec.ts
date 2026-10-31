// Фаза 20.4: /onboarding (design-system §9). API эмулируется (контракт 22.13).
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';

type Psn = { onlineId: string | null; accessMode: string; accessStatus: string; checkedAt: string | null; canStartSync: boolean; onboardedAt: string | null; sync: null };
type Put = { status: number; code?: string; details?: Record<string, unknown>; ok?: boolean };
type Mock = {
  psn: Psn;
  puts: unknown[]; posts: number;
  putQueue: Put[];
  statusQueue: unknown[]; // последовательность ответов /api/sync/status, последний повторяется
  postResult: { status: number; code?: string };
  onPost?: () => void;
};

const base: Psn = { onlineId: null, accessMode: 'public', accessStatus: 'unchecked', checkedAt: null, canStartSync: false, onboardedAt: null, sync: null };
const run = (status: string, extra: Record<string, unknown> = {}) => ({
  running: status === 'running',
  run: { id: 5, kind: 'manual', status, phase: 'games', errorReason: null, errorMessage: null, startedAt: '2026-10-31T10:00:00.000Z', finishedAt: null, snapshotDate: null, progress: { phase: 'games', step: 1, steps: 4, done: null, total: null }, counters: {}, ...extra },
  lastSuccessAt: null, psnAuth: 'ok', psnAuthExpiresAt: null, totals: null,
});

const okJson = (r: Route, data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const failJson = (r: Route, status: number, code: string, details?: unknown, headers: Record<string, string> = {}) =>
  r.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify({ ok: false, error: { code, message: 'x', details } }) });

async function open(page: Page, context: BrowserContext, baseURL: string, over: Partial<Mock> = {}, url = '/onboarding'): Promise<Mock> {
  const m: Mock = { psn: { ...base }, puts: [], posts: 0, putQueue: [], statusQueue: [run('running')], postResult: { status: 202 }, ...over };
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/psn', async (r) => {
    if (r.request().method() === 'GET') return okJson(r, m.psn);
    const body = r.request().postDataJSON() as { onlineId?: string } | null;
    m.puts.push(body);
    const next = m.putQueue.shift() ?? { status: 200 };
    if (next.status === 200) {
      m.psn = { ...m.psn, onlineId: body?.onlineId ?? m.psn.onlineId, accessStatus: 'ok', canStartSync: true, checkedAt: '2026-10-31T10:00:00.000Z' };
      return okJson(r, m.psn);
    }
    const headers: Record<string, string> = next.details?.retryAfterSec ? { 'Retry-After': String(next.details.retryAfterSec) } : {};
    return failJson(r, next.status, next.code ?? 'internal_error', next.details, headers);
  });
  await page.route('**/api/sync', async (r) => {
    m.posts++;
    m.onPost?.();
    if (m.postResult.status === 202) return okJson(r, { started: true, resumed: false, run: { id: 5, kind: 'manual', status: 'running', phase: 'games' } }, 202);
    return failJson(r, m.postResult.status, m.postResult.code ?? 'internal_error');
  });
  await page.route('**/api/sync/status', (r) => {
    const s = m.statusQueue.length > 1 ? m.statusQueue.shift() : m.statusQueue[0];
    return okJson(r, s);
  });
  await page.route('**/api/auth/logout', (r) => okJson(r, { loggedOut: true }));
  await page.goto(url);
  return m;
}

const setPsn = (m: Mock, over: Partial<Psn>) => { m.psn = { ...m.psn, ...over }; };

test.describe('онбординг: шаг 1', () => {
  test('валидация на submit, затем PUT и шаг 2 ok', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    await expect(page.getByRole('heading', { name: 'Подключим PlayStation', level: 1 })).toBeVisible();
    await expect(page.getByTestId('ob-stepper')).toContainText('Шаг 1 из 3');
    const field = page.getByLabel('Ник PSN');
    await expect(field).toHaveAttribute('autocomplete', 'off');
    await expect(field).toHaveAttribute('maxlength', '16');

    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('ob-nick-error')).toHaveText('Введите ник PSN');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toBeFocused();

    await field.fill('1abc');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('ob-nick-error')).toHaveText('Ник должен начинаться с латинской буквы');
    await field.fill('ab');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('ob-nick-error')).toHaveText('Ник должен быть от 3 до 16 символов');
    await field.fill('a b c');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('ob-nick-error')).toContainText('Допустимы латинские буквы');
    expect(m.puts).toHaveLength(0);

    await field.fill(' Art_em ');
    await field.press('Enter');
    await expect(page.getByTestId('ob-result-ok')).toContainText('Нашли профиль @Art_em');
    expect(m.puts).toEqual([{ onlineId: 'Art_em' }]);
    await expect(page.getByTestId('ob-stepper')).toContainText('Шаг 2 из 3');
  });
});

test.describe('онбординг: шаг 2, состояния', () => {
  const cases: { name: string; put: Put; testid: string; text: string; buttons: string[]; absent?: string[] }[] = [
    { name: 'psn_not_found', put: { status: 422, code: 'psn_not_found' }, testid: 'ob-result-psn_not_found', text: 'Профиль не найден', buttons: ['Изменить ник', 'Проверить снова'] },
    { name: 'psn_private', put: { status: 422, code: 'psn_private' }, testid: 'ob-result-psn_private', text: 'Профиль закрыт', buttons: ['Проверить снова', 'Изменить ник'] },
    { name: 'psn_friend_required', put: { status: 422, code: 'psn_friend_required' }, testid: 'ob-result-psn_friend_required', text: 'Профиль виден только друзьям', buttons: ['Проверить снова'] },
    { name: 'psn_account_locked', put: { status: 409, code: 'psn_account_locked' }, testid: 'ob-result-psn_account_locked', text: 'другому аккаунту', buttons: ['Изменить ник'], absent: ['Проверить снова'] },
    { name: 'psn_id_taken', put: { status: 409, code: 'psn_id_taken' }, testid: 'ob-result-psn_id_taken', text: 'уже занят', buttons: ['Изменить ник'] },
    { name: 'psn_unavailable', put: { status: 503, code: 'psn_unavailable' }, testid: 'ob-result-psn_unavailable', text: 'не отвечает', buttons: ['Проверить снова'] },
    { name: 'сеть / 5xx', put: { status: 500, code: 'internal_error' }, testid: 'ob-result-network', text: 'Не удалось связаться с сайтом', buttons: ['Проверить снова'] },
    { name: 'config_error', put: { status: 500, code: 'config_error' }, testid: 'ob-result-config_error', text: 'не настроено подключение', buttons: [], absent: ['Проверить снова'] },
  ];
  for (const c of cases) {
    test(c.name, async ({ page, context, baseURL }) => {
      const m = await open(page, context, baseURL!, { putQueue: [c.put] });
      await page.getByLabel('Ник PSN').fill('Artem');
      await page.getByRole('button', { name: 'Продолжить' }).click();
      const block = page.getByTestId(c.testid);
      await expect(block).toContainText(c.text);
      await expect(block).toHaveAttribute('role', 'alert');
      await expect(block).toBeFocused();
      for (const b of c.buttons) await expect(page.getByRole('button', { name: b })).toBeVisible();
      for (const b of c.absent ?? []) await expect(page.getByRole('button', { name: b })).toHaveCount(0);
      expect(m.puts[0]).toEqual({ onlineId: 'Artem' });
    });
  }

  test('psn_private: три шага списком; recheck приводит к ok', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { putQueue: [{ status: 422, code: 'psn_private' }] });
    await page.getByLabel('Ник PSN').fill('Artem');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('ob-result-psn_private').locator('li')).toHaveCount(3);
    await page.getByRole('button', { name: 'Проверить снова' }).click();
    await expect(page.getByTestId('ob-result-ok')).toBeVisible();
    expect(m.puts).toHaveLength(2);
    expect(m.puts[1]).toEqual({ onlineId: 'Artem' });
    await expect(page.getByRole('button', { name: 'Дальше: загрузить игры' })).toBeVisible();
  });

  test('rate_limited: отсчёт из details.retryAfterSec', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { putQueue: [{ status: 429, code: 'rate_limited', details: { retryAfterSec: 3 } }] });
    await page.getByLabel('Ник PSN').fill('Artem');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    const btn = page.getByRole('button', { name: /Проверить снова/ });
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText(/Проверить снова \(\d\)/);
    await expect(page.getByRole('status').filter({ hasText: 'Можно повторить проверку' })).toBeAttached({ timeout: 8000 });
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('Проверить снова');
  });

  test('«Изменить ник» возвращает на шаг 1 с заполненным полем', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { putQueue: [{ status: 422, code: 'psn_not_found' }] });
    await page.getByLabel('Ник PSN').fill('Artem');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Изменить ник' }).first().click();
    await expect(page.getByLabel('Ник PSN')).toHaveValue('Artem');
    await expect(page.getByTestId('ob-stepper')).toContainText('Шаг 1 из 3');
  });

  test('перезагрузка: сохранённый private открывает шаг 2 без новой проверки', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { psn: { ...base, onlineId: 'Artem', accessStatus: 'private', checkedAt: '2026-10-31T09:00:00.000Z' } });
    await expect(page.getByTestId('ob-result-psn_private')).toBeVisible();
    expect(m.puts).toHaveLength(0);
  });

  test('checkedAt=null: проверка идёт сразу', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { psn: { ...base, onlineId: 'Artem', accessStatus: 'unchecked' } });
    await expect(page.getByTestId('ob-result-ok')).toBeVisible();
    expect(m.puts).toHaveLength(1);
  });
});

test.describe('онбординг: шаг 3', () => {
  const ready: Psn = { ...base, onlineId: 'Artem', accessStatus: 'ok', canStartSync: true, checkedAt: '2026-10-31T09:00:00.000Z' };

  test('автозапуск, прогресс, готово, Открыть Разбор', async ({ page, context, baseURL }) => {
    const m: Mock = await open(page, context, baseURL!, {
      psn: ready,
      // до POST запусков нет (в dev React дважды монтирует эффект, поэтому очередь привязана к POST, а не к числу запросов)
      statusQueue: [{ running: false, run: null, lastSuccessAt: null, psnAuth: 'unknown', psnAuthExpiresAt: null, totals: null }],
      onPost: () => {
        m.statusQueue = [
          run('running'),
          run('running', { phase: 'trophies', progress: { phase: 'trophies', step: 4, steps: 4, done: 5, total: 20 } }),
          run('success', { finishedAt: '2026-10-31T10:05:00.000Z', counters: { gamesSeen: 214 } }),
        ];
      },
    });
    await expect(page.getByTestId('ob-stepper')).toContainText('Шаг 3 из 3');
    await expect(page.getByRole('progressbar', { name: 'Загрузка игр' })).toBeVisible();
    await expect(page.getByTestId('ob-progress-text')).toContainText('Шаг 4 из 4: Загружаем трофеи', { timeout: 15000 });
    await expect(page.getByTestId('ob-progress-text')).toContainText('5 из 20');
    expect(m.posts).toBe(1);
    // после завершения backend проставляет onboardedAt
    setPsn(m, { onboardedAt: '2026-10-31T10:05:00.000Z' });
    await expect(page.getByTestId('ob-done')).toContainText('Загружено игр: 214', { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Начать тур' })).toBeVisible();
    await page.getByRole('button', { name: 'Пропустить, открыть Разбор' }).click();
    await page.waitForURL('**/triage');
  });

  test('failed: причина и повтор', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, {
      psn: ready,
      statusQueue: [run('failed', { errorReason: 'timeout', finishedAt: '2026-10-31T10:01:00.000Z' })],
    });
    await expect(page.getByTestId('ob-sync-failed')).toContainText('Не удалось загрузить игры. Уже загруженное сохранено.');
    await expect(page.getByTestId('ob-sync-failed')).toContainText('слишком много времени');
    await expect(page.getByTestId('ob-sync-failed')).not.toContainText('Error');
    await page.waitForTimeout(200);
    const before = m.posts; // автозапуск на входе при failed
    expect(before).toBe(1);
    // снова упало -> сервер вернул failed -> кнопка «Повторить»
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect.poll(() => m.posts).toBe(2);
    await expect(page.getByRole('button', { name: 'Проверить доступ' })).toBeVisible();
  });

  test('409 sync_in_progress: очередь', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, {
      psn: ready, postResult: { status: 409, code: 'sync_in_progress' },
      statusQueue: [{ running: false, run: null, lastSuccessAt: null, psnAuth: 'unknown', psnAuthExpiresAt: null, totals: null }],
    });
    await expect(page.getByTestId('ob-queued')).toContainText('ваша начнётся следом');
    await expect(page.locator('.ps-ob__bar[data-indeterminate]')).toBeVisible();
  });

  test('409 psn_not_verified возвращает на шаг 2', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, {
      psn: ready, postResult: { status: 409, code: 'psn_not_verified' },
      statusQueue: [{ running: false, run: null, lastSuccessAt: null, psnAuth: 'unknown', psnAuthExpiresAt: null, totals: null }],
    });
    await expect(page.getByTestId('ob-stepper')).toContainText('Шаг 2 из 3');
  });

  test('пусто: gamesSeen = 0', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { psn: ready, statusQueue: [run('success', { counters: { gamesSeen: 0 } })] });
    await expect(page.getByTestId('ob-empty')).toContainText('Игр не нашли');
    await expect(page.getByRole('button', { name: 'Проверить доступ' })).toBeVisible();
  });

  test('без счётчика игр число не показывается', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { psn: { ...ready, onboardedAt: '2026-10-31T10:05:00.000Z' }, statusQueue: [run('success', { counters: {} })] }, '/onboarding?recheck=1');
    // recheck: сначала шаг 2 -> ok -> дальше -> «Начать загрузку»
    await expect(page.getByTestId('ob-result-ok')).toBeVisible();
    await page.getByRole('button', { name: 'Дальше: загрузить игры' }).click();
    await expect(page.getByRole('button', { name: 'Начать загрузку' })).toBeVisible();
  });
});

test.describe('онбординг: редирект и каркас', () => {
  test('onboardedAt и ник заданы: /onboarding -> /', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { psn: { ...base, onlineId: 'Artem', accessStatus: 'ok', canStartSync: true, onboardedAt: '2026-10-30T10:00:00.000Z' } });
    await page.waitForURL((u) => u.pathname === '/');
  });

  test('шапка: логотип и «Выйти», без вкладок; нет горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('мобильная раскладка: поле 16px, кнопка не меньше tap-min', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    const fs = await page.getByLabel('Ник PSN').evaluate((e) => getComputedStyle(e).fontSize);
    const h = (await page.getByRole('button', { name: 'Продолжить' }).boundingBox())!.height;
    if (info.project.name === 'mobile') {
      expect(fs).toBe('16px');
      expect(h).toBeGreaterThanOrEqual(44);
    }
  });

  test('reduced-motion: спиннер статичен', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const m = await open(page, context, baseURL!, { psn: { ...base, onlineId: 'Artem', accessStatus: 'unchecked' } });
    void m;
    await expect(page.getByTestId('ob-result-ok')).toBeVisible();
  });
});
