'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

const ALL = [
  { id: 'rm-goal', label: 'Цель' },
  { id: 'rm-tl', label: 'Таймлайн' },
  { id: 'rm-releases', label: 'Релизы' },
  { id: 'rm-queue', label: 'Очередь' },
  { id: 'rm-attention', label: 'Внимание' },
] as const;

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nowMs = () => Date.now();

/** Липкая капсула блоков Плана: подсветка сразу по касанию и по прокрутке. */
export function RoadmapJump({ attention }: { attention: boolean }) {
  const items = useMemo(() => ALL.filter((s) => s.id !== 'rm-attention' || attention), [attention]);
  const idsKey = items.map((s) => s.id).join();
  const [active, setActive] = useState<string>(items[0]?.id ?? 'rm-goal');
  const shown = items.some((s) => s.id === active) ? active : (items[0]?.id ?? 'rm-goal');
  const lock = useRef(0);

  const update = useCallback(() => {
    if (nowMs() < lock.current) return;
    const list = idsKey.split(',').filter(Boolean);
    if (!list.length) return;
    const nav = document.querySelector<HTMLElement>('[data-testid="rm-jump"]');
    const line = (nav?.getBoundingClientRect().bottom ?? 80) + 8;
    let cur = list[0];
    for (const id of list) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line + 1) cur = id;
    }
    const vh = window.innerHeight;
    if (window.scrollY + vh >= document.documentElement.scrollHeight - 2) {
      const last = list[list.length - 1];
      const lastEl = document.getElementById(last);
      if (lastEl && lastEl.getBoundingClientRect().top < vh) cur = last;
    }
    if (window.scrollY <= 0) cur = list[0];
    setActive(cur);
  }, [idsKey]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
    const t = window.setTimeout(update, 0);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [update]);

  function go(id: string, e: MouseEvent<HTMLAnchorElement>) {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    setActive(id);
    lock.current = nowMs() + 800;
    el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
  }

  return (
    <nav className="ps-rm-jump ps-jumpcap" aria-label="Блоки плана" data-testid="rm-jump">
      {items.map((s) => (
        <a key={s.id} className="ps-rm-jump__a" href={`#${s.id}`} aria-current={shown === s.id ? 'true' : undefined} onClick={(e) => go(s.id, e)}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
