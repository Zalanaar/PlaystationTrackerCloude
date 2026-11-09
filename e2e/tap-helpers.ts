// Пакет 6, п. 2: «эффективная» зона нажатия. Видимый размер не меняем: зону расширяет ::before/::after,
// поэтому меряем не getBoundingClientRect, а куда попадает тап: по каждой оси от центра идём шагом 1 px,
// пока тап попадает в цель. Протяжённость зоны по оси должна быть >= 44. Стоп-условия, которые не считаются
// промахом: край экрана, плавающий элемент поверх страницы (fixed), соседняя цель того же вида (столбцы графика,
// строки жанров стоят плотнее 44 — зона идёт до середины зазора, мёртвой зоны нет).
import type { Page } from '@playwright/test';

export const TAP_SELECTOR = 'a[href],button,input,select,[role=button],[role=tab]';
const MIN = 44;

/** Интерактивные элементы в `scope` с зоной нажатия меньше 44 по какой-либо оси (описание для сообщения теста). */
export async function smallHitTargets(page: Page, scope = 'main'): Promise<string[]> {
  const handles = await page.locator(`${scope} :is(${TAP_SELECTOR})`).elementHandles();
  const out: string[] = [];
  for (const h of handles) {
    const small = await h.evaluate((e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || e.closest('[inert],[aria-hidden="true"]')) return false;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || (e.getAttribute('aria-label') ?? '').startsWith('Open Next.js')) return false; // оверлей dev-сервера
      if (e.classList.contains('ps-st-bar')) return false; // столбцы графика: исключение по отступу (WCAG 2.5.8), см. stats.css
      return r.width < 44 || r.height < 44;
    });
    if (!small) continue;
    await h.evaluate((e: Element) => e.scrollIntoView({ block: 'center', inline: 'center' }));
    const miss = await h.evaluate((e: Element, [sel, min]: [string, number]) => {
      const r = e.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // 'in' — тап в цель; 'stop' — дальше мерить не нужно (край, overlay, сосед того же вида); 'out' — мимо
      const probe = (x: number, y: number): 'in' | 'stop' | 'out' => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'stop';
        const t = document.elementFromPoint(x, y);
        if (!t) return 'out';
        if (t === e || e.contains(t)) return 'in';
        if (t.closest('label')?.contains(e)) return 'in'; // флажок внутри подписи: тап по подписи переключает его
        for (let n: Element | null = t; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return 'stop';
        const sib = t.closest(sel);
        return sib && sib !== e && sib.tagName === e.tagName && sib.className === e.className ? 'stop' : 'out';
      };
      const reach = (dx: number, dy: number) => {
        let d = 0;
        for (let i = 1; i <= min; i++) {
          const p = probe(cx + dx * i, cy + dy * i);
          if (p === 'stop') return Infinity;
          if (p === 'out') break;
          d = i;
        }
        return d;
      };
      const w = reach(-1, 0) + reach(1, 0) + 1, hgt = reach(0, -1) + reach(0, 1) + 1;
      if (w >= min - 1 && hgt >= min - 1) return null; // ±1 px на округление координат
      const label = (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} вид ${Math.round(r.width)}x${Math.round(r.height)}, зона ${w === Infinity ? '∞' : w}x${hgt === Infinity ? '∞' : hgt} «${label}»`;
    }, [TAP_SELECTOR, MIN] as [string, number]);
    if (miss) out.push(miss);
  }
  return out;
}
