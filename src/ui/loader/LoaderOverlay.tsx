'use client';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { STATUS_ICON_PATHS } from '../tokens';
import { createLoaderGate } from './gate';
import './loader.css';

// Порядок знаков PlayStation: ○ △ □ ✕. Цвета только через токены статусов (--st-*), одинаково во всех темах.
const SIGNS = [
  { icon: 'circle', cssVar: '--st-completed' },
  { icon: 'triangle', cssVar: '--st-playing' },
  { icon: 'square', cssVar: '--st-backlog' },
  { icon: 'cross', cssVar: '--st-dropped' },
] as const;

/** true, когда лоадер надо показывать (с задержкой и минимумом показа, см. gate.ts). */
export function useLoaderVisible(loading: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const gate = useMemo(() => createLoaderGate(setVisible), []);
  useEffect(() => () => gate.dispose(), [gate]);
  useEffect(() => { gate.set(loading); }, [gate, loading]);
  return visible;
}

/**
 * Лоадер области контента: размытие + четыре знака по очереди. Позиция fixed между шапкой и нижней навигацией,
 * поэтому не двигает вёрстку, а шапка и навигация остаются резкими и кликабельными.
 * Правило со скелетонами: скелет остаётся каркасом первой отрисовки (под оверлеем без shimmer), индикацию несёт оверлей;
 * при повторной загрузке оверлей лежит поверх уже показанных данных.
 * `contentRef` — корень вида: на время показа получает inert и aria-busy. Диалоги живут в порталах вне корня и не затрагиваются.
 */
export function LoaderOverlay({ loading, contentRef }: { loading: boolean; contentRef?: RefObject<HTMLElement | null> }) {
  const visible = useLoaderVisible(loading);
  useEffect(() => {
    const el = contentRef?.current;
    if (!el || !visible) return;
    el.setAttribute('inert', '');
    el.setAttribute('aria-busy', 'true');
    return () => { el.removeAttribute('inert'); el.removeAttribute('aria-busy'); };
  }, [visible, contentRef]);
  if (!visible) return null;
  return (
    <div className="ps-loader" role="status" aria-busy="true" data-testid="loader-overlay">
      <span className="ps-sr">Загрузка…</span>
      <div className="ps-loader__signs" aria-hidden="true">
        {SIGNS.map((s, i) => (
          <svg
            key={s.icon} className="ps-loader__sign" viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" focusable="false"
            style={{ color: `var(${s.cssVar})`, animationDelay: `calc(var(--loader-step) * ${i})` }}
          >
            <path d={STATUS_ICON_PATHS[s.icon]} />
          </svg>
        ))}
      </div>
    </div>
  );
}
