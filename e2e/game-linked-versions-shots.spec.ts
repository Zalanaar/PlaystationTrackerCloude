// QA Фазы 23: окно игры со «Связанные версии» в 7 темах, десктоп и мобильный. Без SHOTS_DIR пропускается.
// Запуск: SHOTS_DIR=... PW_CHROMIUM_PATH=/usr/bin/google-chrome npx playwright test e2e/game-linked-versions-shots.spec.ts
import { test, expect } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
test.skip(!SHOTS, 'нужен SHOTS_DIR');

const list = (): G[] => [{
  id: 1, title: 'Final Fantasy XVI', lastPlayedAt: '2026-10-01T10:00:00.000Z', status: 'completed', completedAt: '2026-10-01T10:00:00.000Z', droppedAt: null,
  playSeconds: 144_000, playCount: 5, trophies: null, platform: 'PS5',
  linked: [{ gameId: 2, title: 'Final Fantasy XVI Очень длинное название издания для проверки переноса', platform: 'PS4', hours: 4 }, { gameId: 3, title: 'FFXVI', platform: 'PS4', hours: 0 }],
}];

for (const theme of THEMES) {
  test(`окно игры ${theme}`, async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    await mockApi(page, list());
    await page.goto('/?game=1');
    await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, theme);
    const block = page.getByTestId('linked-versions');
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();
    await block.getByRole('button', { name: 'Это не дубль' }).click();
    const hs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(hs).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}.png` });
  });
}
