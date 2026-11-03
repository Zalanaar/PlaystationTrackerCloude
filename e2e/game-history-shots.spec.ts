// Снимки Фазы 34: «История игры» в 7 темах, десктоп и мобильный. Без SHOTS_DIR пропускается.
// Запуск: SHOTS_DIR=... PW_CHROMIUM_PATH=/usr/bin/google-chrome QA_PORT=3341 npx playwright test -c e2e/qa.config.ts game-history-shots.spec.ts
import { test, expect } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
test.skip(!SHOTS, 'нужен SHOTS_DIR');

const week = (weekStart: string, seconds = 0, estimatedSeconds = 0, trophies = 0, platinum = false) => ({ weekStart, seconds, estimatedSeconds, trophies, platinum });
const starts = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 0, 5) + i * 7 * 86_400_000).toISOString().slice(0, 10));
const weeks = starts.map((s, i) => week(s, i < 8 ? 3600 * ((i % 4) + 1) : i % 5 === 0 ? 0 : 3600 * ((i * 7) % 9), i < 8 ? 3600 * ((i % 4) + 1) - (i === 7 ? 1800 : 0) : 0, i % 6 === 2 ? 2 : 0, i === 38));
const history = { weeks, truncated: false, hasHours: true, hasEstimate: true, playedDays: 74, firstSnapshotDate: starts[7] };

const list = (): G[] => [{
  id: 1, title: 'Final Fantasy XVI', lastPlayedAt: '2026-10-01T10:00:00.000Z', status: 'playing', completedAt: null, droppedAt: null,
  playSeconds: 144_000, playCount: 5, trophies: null, platform: 'PS5',
}];

for (const theme of THEMES) {
  test(`история игры ${theme}`, async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    const mock = await mockApi(page, list());
    mock.histories[1] = history;
    await page.goto('/?game=1');
    await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, theme);
    const block = page.getByTestId('game-history');
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await block.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}.png` });
  });
}
