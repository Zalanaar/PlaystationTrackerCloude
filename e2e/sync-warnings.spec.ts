// П10 «Видимость»: в панели синка тексты предупреждений последнего запуска (до 5), а не только их число. API эмулируется.
import { test, expect, type Page } from '@playwright/test';
import { signedSession } from './session';
import { emptyGamesBody } from './collection-mock';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page: Page, baseURL: string, run: Record<string, unknown>) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } })));
  await page.route('**/api/sync/status', (r) => r.fulfill(json({ ok: true, data: {
    totals: null, running: false, lastSuccessAt: '2026-11-01T05:00:00.000Z', psnAuth: 'ok', psnAuthExpiresAt: null, psnToken: null,
    run: {
      id: 7, kind: 'daily', status: 'success', phase: 'trophies', errorReason: null, errorMessage: null,
      startedAt: '2026-11-01T05:00:00.000Z', finishedAt: '2026-11-01T05:01:00.000Z',
      progress: { phase: 'trophies', step: 4, steps: 4, done: null, total: null }, counters: null, ...run,
    },
  } })));
  await page.route('**/api/games**', (r) => r.fulfill(json(emptyGamesBody(r.request().url()))));
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
}

test('тексты предупреждений: последние 5 и подпись «показаны последние»', async ({ page, baseURL }) => {
  const warnings = Array.from({ length: 5 }, (_, i) => ({ code: `hltb_failed`, message: `Сет NPWR0000${i}_00: русские названия не загрузились (timeout).` }));
  await open(page, baseURL!, { warningsCount: 7, warnings });
  const box = page.getByTestId('sync-warnings');
  await expect(box).toContainText('Последний запуск: 7 предупреждений');
  await expect(box.getByRole('listitem')).toHaveCount(5);
  await expect(box.getByRole('listitem').first()).toHaveText(warnings[0].message);
  await expect(box).toContainText('Показаны последние 5.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('без предупреждений блока нет; старый ответ без поля warnings тоже без блока', async ({ page, baseURL }) => {
  await open(page, baseURL!, { warningsCount: 2 });
  await expect(page.getByTestId('run-status')).toBeVisible();
  await expect(page.getByTestId('sync-warnings')).toHaveCount(0);
});

test('F29: «Последний синк: успешно, …» одной строкой; ошибка ИИ — человеческим текстом, код в «Подробнее»', async ({ page, baseURL }) => {
  const warnings = [{ code: 'llm_phrases_failed', message: 'LLM: фразы бэклога, ошибок 3 (http_404:model_not_found), игры повторятся в следующем синке.' }];
  await open(page, baseURL!, { warningsCount: 1, warnings });
  await expect(page.getByTestId('run-status')).toHaveText(/^успешно, /);
  await expect(page.getByText('Последний успешный')).toHaveCount(0);
  const li = page.getByTestId('sync-warnings').getByRole('listitem');
  await expect(li).toContainText('ИИ-подсказки для бэклога не обновились');
  await expect(li.locator('code')).not.toBeVisible();
  await li.getByText('Подробнее').click();
  await expect(li.locator('code')).toContainText('http_404:model_not_found');
});

test('F29: последний запуск с ошибкой — отдельно строка «Последний успешный»', async ({ page, baseURL }) => {
  await open(page, baseURL!, { status: 'failed', errorReason: 'network', errorMessage: 'x' });
  await expect(page.getByTestId('run-status')).toHaveText(/^ошибка, /);
  await expect(page.getByText('Последний успешный')).toBeVisible();
});
