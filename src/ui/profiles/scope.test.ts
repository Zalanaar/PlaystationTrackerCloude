import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveProfileId, readProfileValue, registerCacheReset, resetClientCaches, setActiveProfileId, subscribeProfileScope, writeProfileValue } from './scope';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('область профиля', () => {
  let ls: ReturnType<typeof fakeStorage>;
  beforeEach(() => { ls = fakeStorage(); vi.stubGlobal('localStorage', ls); setActiveProfileId(null); });
  afterEach(() => { vi.unstubAllGlobals(); setActiveProfileId(null); });

  it('ключ включает id активного профиля, значения профилей не смешиваются', () => {
    setActiveProfileId(1);
    writeProfileValue('ps-view', 'list');
    setActiveProfileId(2);
    expect(readProfileValue('ps-view')).toBeNull();
    writeProfileValue('ps-view', 'dense');
    expect([...ls.m.keys()].sort()).toEqual(['ps-view:1', 'ps-view:2']);
    setActiveProfileId(1);
    expect(readProfileValue('ps-view')).toBe('list');
  });

  it('legacy: пока у профиля нет значения, берётся прежний общий ключ', () => {
    ls.setItem('ps-view', 'dense');
    setActiveProfileId(3);
    expect(readProfileValue('ps-view', { legacy: true })).toBe('dense');
    expect(readProfileValue('ps-view')).toBeNull();
    writeProfileValue('ps-view', 'list');
    expect(readProfileValue('ps-view', { legacy: true })).toBe('list');
  });

  it('смена id уведомляет подписчиков, повтор того же id нет', () => {
    const cb = vi.fn();
    const off = subscribeProfileScope(cb);
    setActiveProfileId(5);
    setActiveProfileId(5);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getActiveProfileId()).toBe(5);
    off();
    setActiveProfileId(6);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('сброс кэшей вызывает все сбросчики, ошибка одного не мешает остальным', () => {
    const a = vi.fn(() => { throw new Error('x'); });
    const b = vi.fn();
    const offA = registerCacheReset(a);
    const offB = registerCacheReset(b);
    resetClientCaches();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    offA(); offB();
  });
});
