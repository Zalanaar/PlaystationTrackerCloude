import { describe, expect, it } from 'vitest';
import { navDir, readScroll, shouldIntercept, writeScroll } from './tabTransition';

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
function mem() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; }

describe('tabTransition', () => {
  it('направление по порядку вкладок', () => {
    expect(navDir(0, 2)).toBe('fwd');
    expect(navDir(3, 1)).toBe('back');
  });
  it('перехват только обычного клика на другую вкладку', () => {
    expect(shouldIntercept(click, 0, 1)).toBe(true);
    expect(shouldIntercept(click, 1, 1)).toBe(false);
    expect(shouldIntercept({ ...click, metaKey: true }, 0, 1)).toBe(false);
    expect(shouldIntercept({ ...click, button: 1 }, 0, 1)).toBe(false);
    expect(shouldIntercept({ ...click, defaultPrevented: true }, 0, 1)).toBe(false);
    expect(shouldIntercept(click, -1, 1)).toBe(false);
  });
  it('прокрутка по вкладке: запись, чтение, мусор -> 0', () => {
    const s = mem();
    expect(readScroll(s, 'stats')).toBe(0);
    writeScroll(s, 'stats', 812.6);
    writeScroll(s, 'backlog', -5);
    expect(readScroll(s, 'stats')).toBe(813);
    expect(readScroll(s, 'backlog')).toBe(0);
    s.setItem('ps-tab-scroll', '{oops');
    expect(readScroll(s, 'stats')).toBe(0);
    expect(readScroll(null, 'stats')).toBe(0);
  });
});
