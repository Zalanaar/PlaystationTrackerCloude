// QA Ф34: свёрнутый блок «Длительность прохождения» не теряет введённое при сворачивании/разворачивании; пользователь не может потерять ввод тихо.
import { test, expect } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

test('ввод в «Своя оценка» переживает свернуть/развернуть', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
  await mockApi(page, [{ id: 1, title: 'Stray', lastPlayedAt: '2026-06-06T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null }]);
  await page.goto('/?game=1');
  const dlg = page.getByRole('dialog', { name: 'Stray' });
  const btn = dlg.getByRole('button', { name: /Длительность прохождения/ });
  await btn.click();
  const input = dlg.getByLabel('Своя оценка, часов');
  await input.fill('25');
  await btn.click();
  await expect(input).toBeHidden();
  await btn.click();
  await expect(dlg.getByLabel('Своя оценка, часов')).toHaveValue('25');
});
