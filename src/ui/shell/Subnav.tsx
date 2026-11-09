'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { usePathname } from 'next/navigation';
import { BACKLOG_SUBNAV } from '../tokens';
import { isSubnavActive } from './nav';

/** Подвкладки группы «Бэклог · План · Подскажи» (§8.1). Маршруты, поэтому ссылки. Рендерится в странице вне Suspense. */
export function BacklogSubnav() {
  const pathname = usePathname();
  return (
    <nav className="ps-subnav" aria-label="Раздел бэклога" data-tour="backlog-subnav">
      {BACKLOG_SUBNAV.map((s) => (
        <Link key={s.href} href={s.href} aria-current={isSubnavActive(pathname, s.href) ? 'page' : undefined}>{s.label}</Link>
      ))}
    </nav>
  );
}
