/** Не крутить ряд чипов программно, пока пользователь ведёт его или идёт инерция (iOS momentum). */

export const CHIP_ROW_USER_QUIET_MS = 800;

export type ChipRowScrollGuard = {
  /** Можно ли сейчас вызвать scrollTo (нет недавнего жеста/инерции). */
  canScroll(): boolean;
  /**
   * Один программный scrollTo, если ряд «тих». Если пользователь ещё ведёт —
   * откладываем одну попытку на конец тишины (не на каждый scroll).
   * Возвращает, вызвали ли scrollTo сразу.
   */
  scrollToIfQuiet(left: number, behavior: ScrollBehavior): boolean;
  disconnect(): void;
};

export function attachChipRowScrollGuard(el: HTMLElement): ChipRowScrollGuard {
  let lastUser = 0;
  let programmaticUntil = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let pending: { left: number; behavior: ScrollBehavior } | null = null;

  const markUser = () => { lastUser = Date.now(); };
  const onScroll = () => {
    if (Date.now() < programmaticUntil) return;
    lastUser = Date.now();
  };
  const opts: AddEventListenerOptions = { passive: true };
  el.addEventListener('pointerdown', markUser, opts);
  el.addEventListener('touchstart', markUser, opts);
  el.addEventListener('wheel', markUser, opts);
  el.addEventListener('scroll', onScroll, opts);

  const canScroll = () => Date.now() - lastUser >= CHIP_ROW_USER_QUIET_MS;

  const apply = (left: number, behavior: ScrollBehavior): boolean => {
    if (Math.abs(el.scrollLeft - left) < 1) return false;
    programmaticUntil = Date.now() + (behavior === 'smooth' ? 1000 : 80);
    el.scrollTo({ left, behavior });
    return true;
  };

  const runPending = () => {
    retry = null;
    const job = pending;
    if (!job) return;
    if (!canScroll()) {
      retry = setTimeout(runPending, Math.max(16, CHIP_ROW_USER_QUIET_MS - (Date.now() - lastUser)));
      return;
    }
    pending = null;
    apply(job.left, job.behavior);
  };

  return {
    canScroll,
    scrollToIfQuiet(left: number, behavior: ScrollBehavior) {
      pending = { left, behavior };
      if (!canScroll()) {
        if (retry) clearTimeout(retry);
        retry = setTimeout(runPending, CHIP_ROW_USER_QUIET_MS - (Date.now() - lastUser));
        return false;
      }
      if (retry) { clearTimeout(retry); retry = null; }
      pending = null;
      return apply(left, behavior);
    },
    disconnect() {
      if (retry) clearTimeout(retry);
      retry = null;
      pending = null;
      el.removeEventListener('pointerdown', markUser);
      el.removeEventListener('touchstart', markUser);
      el.removeEventListener('wheel', markUser);
      el.removeEventListener('scroll', onScroll);
    },
  };
}
