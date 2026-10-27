import type { ReactNode } from 'react';
import type { ViewMode } from '../tokens';

/** Сетка обложек (design-system §4.7). Колонки задаёт data-density через токены. Один компонент на все страницы. */
export function GameGrid({ density = 'comfort', children, label }: { density?: Exclude<ViewMode, 'list'>; children: ReactNode; label?: string }) {
  return <ul className="ps-grid" data-density={density} aria-label={label}>{children}</ul>;
}

export function GameGridItem({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}
