'use client';

import { useEffect } from 'react';

// П11.5.1: шаблон пересоздаётся при смене раздела (не при смене ?query), поэтому анимация входа срабатывает на переход между вкладками.
// Первая загрузка без анимации (страница и так появляется со скелета); только мобильная ширина, prefers-reduced-motion — без анимации (route-transition.css).
let navigated = false;

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const animate = navigated;
  useEffect(() => { navigated = true; }, []);
  return <div className="ps-route" data-enter={animate || undefined}>{children}</div>;
}
