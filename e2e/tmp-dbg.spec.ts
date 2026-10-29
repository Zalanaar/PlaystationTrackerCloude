import { test } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';
test('dbg', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
  await mockApi(page, []); await mockRoadmap(page, baseState());
  await page.goto('/roadmap');
  await page.getByTestId('rm-queue-row').first().waitFor();
  await page.getByRole('button', { name: 'Ещё: Хейдес' }).click({ timeout: 5000 }).catch((e) => console.log('CLICK1', String(e).slice(0, 600)));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-PlaystationTrackerCloude/3357ebaa-54cf-539a-9421-a32d1cd76455/scratchpad/dbg.png' });
  await page.getByRole('menuitem', { name: 'Убрать из плана' }).click({ timeout: 5000 }).catch((e) => console.log('CLICK2', String(e).slice(0, 900)));
});
