/** Блокировка прокрутки страницы, пока открыт шит (iOS игнорирует один только overflow: hidden). */
let locks = 0;
let savedY = 0;
let prev: { htmlOverflow: string; bodyOverflow: string; bodyPosition: string; bodyTop: string; bodyLeft: string; bodyRight: string; bodyWidth: string } | null = null;

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  const html = document.documentElement;
  const body = document.body;
  if (locks === 0) {
    savedY = window.scrollY;
    prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${savedY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    html.dataset.scrollLock = '1';
    body.dataset.scrollLock = '1';
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks > 0 || !prev) return;
    html.style.overflow = prev.htmlOverflow;
    body.style.overflow = prev.bodyOverflow;
    body.style.position = prev.bodyPosition;
    body.style.top = prev.bodyTop;
    body.style.left = prev.bodyLeft;
    body.style.right = prev.bodyRight;
    body.style.width = prev.bodyWidth;
    delete html.dataset.scrollLock;
    delete body.dataset.scrollLock;
    prev = null;
    window.scrollTo(0, savedY);
  };
}

/** Для тестов: сбросить счётчик, не трогая стили (afterEach). */
export function resetScrollLockForTests(): void {
  locks = 0;
  prev = null;
  savedY = 0;
}
