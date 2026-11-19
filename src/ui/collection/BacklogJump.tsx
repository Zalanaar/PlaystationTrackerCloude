'use client';

// П15.6: липкий ряд «Блоки страницы» Бэклога (Бэклог / Не куплено / Отложено / Сервис) — прокрутка к блоку и scroll-spy.
import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../format';

export type JumpTab = { id: string; label: string; n: number };

/** Прокрутка к заголовку блока: ниже шапки и липкой панели переключателя (высоты меряем, на мобильном они другие). */
export function scrollToBlock(el: HTMLElement) {
  const headerH = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
  const navH = document.querySelector<HTMLElement>('[data-testid="bl-jump"]')?.offsetHeight ?? 0;
  const top = window.scrollY + el.getBoundingClientRect().top - Math.max(0, headerH) - navH - 8;
  window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/** Сентинел + IntersectionObserver дают data-stuck, scroll-spy даёт aria-current. */
export function useBacklogJump(show: boolean, tabIds: string) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [activeTab, setActiveTab] = useState('h-bl-main');
  const spyLock = useRef(false);
  const spyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // пересчёт scroll-spy после снятия блокировки: прокрутка во время неё иначе не учитывалась
  const spyRun = useRef<() => void>(() => {});
  // F10: блок, к которому перешли по нажатию; держим его подсвеченным, пока его заголовок на экране
  const jumped = useRef<string | null>(null);
  useEffect(() => () => { if (spyTimer.current) clearTimeout(spyTimer.current); }, []);
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    scrollToBlock(el);
    el.focus({ preventScroll: true });
    // клик ставит вкладку активной сразу; пока идёт прокрутка, scroll-spy её не перебивает
    setActiveTab(id);
    jumped.current = id;
    spyLock.current = true;
    if (spyTimer.current) clearTimeout(spyTimer.current);
    spyTimer.current = setTimeout(() => { spyLock.current = false; spyRun.current(); }, 900);
  };

  useEffect(() => {
    if (!show) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // низ шапки меряем: в PWA standalone к --header-h добавляется вырез сверху
    const h = Math.round(document.querySelector('.ps-header')?.getBoundingClientRect().bottom ?? 56);
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: `-${h}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const ids = tabIds.split(',');
    const onScroll = () => {
      if (spyLock.current) return;
      const headerH = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const navH = document.querySelector<HTMLElement>('[data-testid="bl-jump"]')?.offsetHeight ?? 0;
      const line = Math.max(0, headerH) + navH + 16;
      let cur = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      // F10: у низа страницы последние короткие блоки не доходят до линии под липкой панелью —
      // текущим считаем последний блок, чей заголовок виден на экране
      const vh = window.innerHeight;
      if (window.scrollY + vh >= document.documentElement.scrollHeight - 2) {
        for (const id of ids) {
          const t = document.getElementById(id)?.getBoundingClientRect().top;
          if (t !== undefined && t < vh && t >= line - 8) cur = id;
        }
      }
      // F10: блок, выбранный нажатием, остаётся текущим, пока его заголовок виден ниже линии и выше середины экрана
      const j = jumped.current;
      if (j && ids.indexOf(j) > ids.indexOf(cur)) {
        const t = document.getElementById(j)?.getBoundingClientRect().top;
        if (t !== undefined && t >= line - 8 && t < vh) cur = j;
        else jumped.current = null;
      } else if (j && j !== cur) jumped.current = null;
      if (window.scrollY <= 0) cur = ids[0];
      setActiveTab(cur);
    };
    spyRun.current = onScroll;
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const onEnd = () => { spyLock.current = false; onScroll(); };
    window.addEventListener('scrollend', onEnd);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.removeEventListener('scrollend', onEnd); };
  }, [show, tabIds]);
  return { sentinelRef, stuck, activeTab, jumpTo };
}

export function BacklogJumpNav({ tabs, sentinelRef, stuck, activeTab, onJump }: {
  tabs: readonly JumpTab[];
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  stuck: boolean;
  activeTab: string;
  onJump: (id: string) => void;
}) {
  return (
    <>
      <div className="ps-bl-jump__sentinel" ref={sentinelRef} aria-hidden="true" />
      <nav className="ps-bl-jump" aria-label="Блоки страницы" data-testid="bl-jump" data-stuck={stuck ? 'true' : 'false'}>
        <div className="ps-bl-jump__tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" className="ps-bl-jump__tab" aria-current={activeTab === t.id ? 'location' : undefined} onClick={() => onJump(t.id)}>
              {t.label} <b className="num">{formatNumber(t.n)}</b>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
