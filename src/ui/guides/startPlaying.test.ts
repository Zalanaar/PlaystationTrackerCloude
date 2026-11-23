import { afterEach, describe, expect, it, vi } from 'vitest';
import { announcePlaying, PLAYING_EVENT } from './startPlaying';

describe('announcePlaying', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('шлёт событие с id и названием', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const on = vi.fn();
    target.addEventListener(PLAYING_EVENT, on);
    expect(announcePlaying({ id: 7, title: 'Hades' })).toBe(true);
    expect((on.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 7, title: 'Hades' });
  });
});
