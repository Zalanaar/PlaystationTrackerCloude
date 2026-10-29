// QA Фазы 12: шапка 768-1023 с 5 вкладками, все 7 тем на /roadmap без горизонтального скролла, конфликт текстом.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

async function open(page: Page, context: BrowserContext, baseURL: string, theme?: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState());
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
}
const noH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('QA 12: шапка на 768-1023', () => {
  for (const width of [768, 820, 900, 1023]) {
    test(`${width}px: вкладки, «Синк», тема и аватар целы и не выходят за шапку`, async ({ page, context, baseURL, isMobile }) => {
      test.skip(isMobile, 'размер задаётся вручную');
      await page.setViewportSize({ width, height: 800 });
      await open(page, context, baseURL as string);
      expect(await noH(page)).toBe(true);
      const bad = await page.evaluate(() => {
        const h = document.querySelector('header') as HTMLElement;
        const hr = h.getBoundingClientRect();
        return Array.from(h.querySelectorAll<HTMLElement>('a,button')).filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.right > hr.right + 1 || r.left < hr.left - 1 || e.scrollWidth > e.clientWidth + 1);
        }).map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent?.trim() || e.getAttribute('aria-label')} l=${Math.round(r.left)} r=${Math.round(r.right)} hr=${Math.round(hr.right)} sw=${e.scrollWidth} cw=${e.clientWidth}`; });
      });
      expect(bad).toEqual([]);
    });
  }
});

test.describe('QA 12: темы', () => {
  for (const t of THEMES) {
    test(`тема ${t.id}: /roadmap без горизонтального скролла`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL as string, t.id);
      expect(await noH(page)).toBe(true);
      await expect(page.getByTestId('rm-queue-row').first()).toBeVisible();
    });
  }
});
