import { afterEach, describe, expect, it } from 'vitest';
import { lockBodyScroll, resetScrollLockForTests } from './scrollLock';

type FakeEl = { style: Record<string, string>; dataset: Record<string, string | undefined>; removeAttribute: (n: string) => void };

function installDom(scrollY = 0) {
  const make = (): FakeEl => {
    const style: Record<string, string> = { overflow: '', position: '', top: '', left: '', right: '', width: '' };
    const dataset: Record<string, string | undefined> = {};
    return { style, dataset, removeAttribute: (n) => { if (n === 'style') { for (const k of Object.keys(style)) style[k] = ''; } } };
  };
  const html = make();
  const body = make();
  const scrolled: number[] = [];
  const prev = { document: globalThis.document, window: globalThis.window };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: html, body },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      scrollY,
      scrollTo: (...args: unknown[]) => {
        const y = typeof args[0] === 'number' ? args[1] : (args[0] as { top?: number })?.top;
        if (typeof y === 'number') scrolled.push(y);
      },
    },
  });
  return { html, body, scrolled, restore: () => {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: prev.document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: prev.window });
  } };
}

describe('lockBodyScroll', () => {
  let restore = () => {};
  afterEach(() => {
    resetScrollLockForTests();
    restore();
  });

  it('фиксирует body и восстанавливает прокрутку; вложенные шиты держат один замок', () => {
    const d = installDom(240);
    restore = d.restore;
    const a = lockBodyScroll();
    expect(d.body.style.position).toBe('fixed');
    expect(d.body.style.top).toBe('-240px');
    expect(d.body.dataset.scrollLock).toBe('1');
    const b = lockBodyScroll();
    expect(d.body.style.position).toBe('fixed');
    b();
    expect(d.body.dataset.scrollLock).toBe('1');
    a();
    expect(d.body.style.position).toBe('');
    expect(d.body.dataset.scrollLock).toBeUndefined();
    expect(d.scrolled.at(-1)).toBe(240);
  });
});
