import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoaderGate } from './gate';

describe('createLoaderGate', () => {
  const log: boolean[] = [];
  beforeEach(() => { vi.useFakeTimers(); log.length = 0; });
  afterEach(() => vi.useRealTimers());
  const make = () => createLoaderGate((v) => log.push(v));

  it('быстрая загрузка (<200 мс) не показывает оверлей', () => {
    const g = make();
    g.set(true);
    vi.advanceTimersByTime(150);
    g.set(false);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  it('долгая загрузка: показ через 200 мс', () => {
    const g = make();
    g.set(true);
    vi.advanceTimersByTime(199);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual([true]);
  });

  it('после появления висит минимум 400 мс', () => {
    const g = make();
    g.set(true);
    vi.advanceTimersByTime(300); // показ на 200-й, к 300-й прошло 100 мс
    g.set(false);
    vi.advanceTimersByTime(299);
    expect(log).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual([true, false]);
  });

  it('если минимум уже прошёл, скрывается сразу', () => {
    const g = make();
    g.set(true);
    vi.advanceTimersByTime(1200);
    g.set(false);
    expect(log).toEqual([true, false]);
  });

  it('новая загрузка во время дожидания минимума не мигает', () => {
    const g = make();
    g.set(true);
    vi.advanceTimersByTime(200);
    g.set(false);
    vi.advanceTimersByTime(100);
    g.set(true);
    vi.advanceTimersByTime(2000);
    expect(log).toEqual([true]);
    g.set(false);
    expect(log).toEqual([true, false]);
  });

  it('повторные set(true) не плодят таймеры', () => {
    const g = make();
    g.set(true); g.set(true); g.set(true);
    vi.advanceTimersByTime(200);
    expect(log).toEqual([true]);
  });

  it('dispose гасит таймеры', () => {
    const g = make();
    g.set(true);
    g.dispose();
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });
});
