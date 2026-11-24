import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachChipRowScrollGuard, CHIP_ROW_USER_QUIET_MS } from './chipRowScroll';

type FakeEl = HTMLElement & { scrollLeft: number; scrollToCalls: { left: number; behavior?: ScrollBehavior }[]; dispatch(type: string): void };

function fakeRow(): FakeEl {
  const listeners = new Map<string, Set<EventListener>>();
  const el = {
    scrollLeft: 0,
    scrollToCalls: [] as { left: number; behavior?: ScrollBehavior }[],
    addEventListener(type: string, fn: EventListener) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    scrollTo(arg: ScrollToOptions | number) {
      const left = typeof arg === 'number' ? arg : arg.left ?? 0;
      const behavior = typeof arg === 'number' ? undefined : arg.behavior;
      this.scrollLeft = left;
      this.scrollToCalls.push({ left, behavior });
      listeners.get('scroll')?.forEach((fn) => fn(new Event('scroll')));
    },
    dispatch(type: string) {
      listeners.get(type)?.forEach((fn) => fn(new Event(type)));
    },
  };
  return el as unknown as FakeEl;
}

describe('ряд чипов: программный scroll не спорит с жестом', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('сразу крутит, если пользователь не трогал ряд', () => {
    const el = fakeRow();
    const g = attachChipRowScrollGuard(el);
    expect(g.scrollToIfQuiet(120, 'auto')).toBe(true);
    expect(el.scrollToCalls).toEqual([{ left: 120, behavior: 'auto' }]);
    g.disconnect();
  });

  it('не крутит во время жеста и ~800 мс инерции; один отложенный вызов', () => {
    const el = fakeRow();
    const g = attachChipRowScrollGuard(el);
    el.dispatch('pointerdown');
    expect(g.canScroll()).toBe(false);
    expect(g.scrollToIfQuiet(80, 'smooth')).toBe(false);
    expect(g.scrollToIfQuiet(90, 'smooth')).toBe(false);
    expect(el.scrollToCalls).toEqual([]);
    vi.advanceTimersByTime(CHIP_ROW_USER_QUIET_MS - 1);
    expect(el.scrollToCalls).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(el.scrollToCalls).toEqual([{ left: 90, behavior: 'smooth' }]);
    g.disconnect();
  });

  it('scroll от пользователя продлевает тишину; программный scroll — нет', () => {
    const el = fakeRow();
    const g = attachChipRowScrollGuard(el);
    expect(g.scrollToIfQuiet(40, 'auto')).toBe(true);
    expect(g.canScroll()).toBe(true);
    el.dispatch('scroll'); // после программного — не считаем жестом
    expect(g.canScroll()).toBe(true);
    el.scrollLeft = 10;
    // жест: scroll без программного окна
    vi.advanceTimersByTime(1100);
    el.dispatch('touchstart');
    el.dispatch('scroll');
    expect(g.canScroll()).toBe(false);
    expect(g.scrollToIfQuiet(200, 'auto')).toBe(false);
    expect(el.scrollToCalls).toHaveLength(1);
    g.disconnect();
  });
});
